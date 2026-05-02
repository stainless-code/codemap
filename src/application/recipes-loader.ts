import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * One agent-facing follow-up suggested for every row of a recipe's result.
 * Recipe authors hand-write this alongside the SQL (predictable: every row gets
 * the same template). Ad-hoc SQL never carries actions — recipe-only feature.
 *
 * `auto_fixable` defaults to `false` when omitted. `description` is human prose
 * for the agent to surface; `type` is a stable kebab-case verb the agent can
 * key off (`delete-file`, `split-barrel`, `flag-caller`, …).
 */
export interface RecipeAction {
  type: string;
  auto_fixable?: boolean;
  description?: string;
}

/**
 * One loaded recipe — the canonical shape the loader returns. Bundled and
 * project recipes share this shape; `source` discriminates them. `shadows`
 * is true when a project recipe overrides a bundled recipe of the same id
 * (see plan §9 Q-E — agents read this at session start to know when a
 * recipe behaves differently from the documented bundled version).
 */
export interface LoadedRecipe {
  id: string;
  sql: string;
  description: string | undefined;
  body: string | undefined;
  actions: RecipeAction[] | undefined;
  source: "bundled" | "project";
  shadows: boolean;
}

export interface LoadRecipesOpts {
  /**
   * Absolute path to the directory containing bundled recipe `.sql` files.
   * Resolved by the caller via `resolveBundledRecipesDir()` (npm package
   * layout — `templates/recipes/` next to `templates/agents/`).
   */
  bundledDir: string;
  /**
   * Absolute path to the project's `.codemap/recipes/` directory, or
   * `undefined` if it doesn't exist. Tracer 3 wires this; Tracer 1
   * accepts but doesn't read it.
   */
  projectDir: string | undefined;
}

/**
 * Eager loader — reads every `<id>.sql` from `bundledDir` (and `projectDir`
 * once Tracer 3 lands), pairs each with optional `<id>.md`, applies
 * load-time validation (non-empty SQL after stripping comments;
 * lexical DML/DDL deny-list — Tracer 5), and returns the merged list.
 *
 * Project recipes win on id collision (`shadows: true` flag; see plan
 * §9 Q-E). Per plan §9 Q-B (eager startup load), this is called once
 * at module init in `cli/query-recipes.ts`'s shim layer; the result
 * is module-cached for the process lifetime.
 */
export function loadAllRecipes(opts: LoadRecipesOpts): LoadedRecipe[] {
  const bundled = readRecipesFromDir(opts.bundledDir, "bundled");
  const project =
    opts.projectDir !== undefined
      ? readRecipesFromDir(opts.projectDir, "project")
      : [];
  return mergeRecipes(bundled, project);
}

/**
 * Project recipes win on id collision; matching bundled entries are filtered
 * out and the project entry's `shadows` flag is flipped to `true`. Order:
 * project first (in id order), then bundled (in id order) — the catalog
 * surface stays deterministic per directory listing.
 */
export function mergeRecipes(
  bundled: LoadedRecipe[],
  project: LoadedRecipe[],
): LoadedRecipe[] {
  const projectIds = new Set(project.map((r) => r.id));
  const flaggedProject = project.map((r) => ({
    ...r,
    shadows: projectIds.has(r.id) && bundled.some((b) => b.id === r.id),
  }));
  const filteredBundled = bundled.filter((r) => !projectIds.has(r.id));
  return [...flaggedProject, ...filteredBundled].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/**
 * Read every `<id>.sql` from `dir`, pair with optional `<id>.md`. Returns
 * `[]` if the directory doesn't exist (project-recipes case — absence of
 * `.codemap/recipes/` is not an error). Throws with recipe-aware error
 * messages if a `<id>.sql` fails load-time validation (empty after
 * comment-stripping, or starts with a DML / DDL keyword).
 *
 * The runtime `PRAGMA query_only=1` backstop in `executeQuery` (PR #35)
 * stays as the parser-proof safety net for anything this lexical scan
 * can't catch (multi-statement payloads, `WITH foo AS (DELETE …) SELECT`
 * sub-queries, attached databases). Different jobs: lexical = good UX
 * for common mistakes; backstop = correctness no matter what.
 */
export function readRecipesFromDir(
  dir: string,
  source: "bundled" | "project",
): LoadedRecipe[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];

  const entries = readdirSync(dir);
  const recipes: LoadedRecipe[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".sql")) continue;
    const id = entry.slice(0, -".sql".length);
    if (id.length === 0) continue;
    const sqlPath = join(dir, entry);
    const sql = readFileSync(sqlPath, "utf8");
    validateRecipeSql(id, sqlPath, sql);

    const mdPath = join(dir, `${id}.md`);
    const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : undefined;
    const { actions, body } =
      md !== undefined
        ? extractFrontmatterAndBody(md)
        : { actions: undefined, body: undefined };
    const description =
      body !== undefined ? firstNonEmptyLine(body) : undefined;

    recipes.push({
      id,
      sql,
      description,
      body,
      actions,
      source,
      shadows: false,
    });
  }

  return recipes.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Throws with a recipe-aware message if `sql` is empty (after stripping
 * `--` line comments) or starts with a DML / DDL keyword. Caller keeps
 * the path for the error message; the parser-proof runtime backstop in
 * `executeQuery` is the safety net beyond this.
 */
export function validateRecipeSql(
  id: string,
  sqlPath: string,
  sql: string,
): void {
  if (isEffectivelyEmpty(sql)) {
    throw new Error(
      `Recipe "${id}" at ${sqlPath} is empty (no SQL after stripping -- comments and whitespace).`,
    );
  }
  const firstKeyword = firstSqlKeyword(sql);
  if (firstKeyword !== undefined && DML_DDL_DENY.has(firstKeyword)) {
    throw new Error(
      `Recipe "${id}" at ${sqlPath} starts with "${firstKeyword}" — recipes must be read-only. Use \`codemap query --save-baseline\` for capturing rows; the runtime PRAGMA query_only=1 guard would also reject this at execution time.`,
    );
  }
}

const DML_DDL_DENY = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "ATTACH",
  "DETACH",
  "REPLACE",
  "TRUNCATE",
  "VACUUM",
  "PRAGMA",
]);

/**
 * First identifier-shaped token in `sql` after stripping `--` line
 * comments and leading whitespace. Returns the upper-cased keyword
 * (SQLite is case-insensitive for keywords) or `undefined` if no token
 * exists. Doesn't try to be clever about strings or block-style comments
 * (those are rare in recipes; the runtime backstop catches what slips by).
 */
function firstSqlKeyword(sql: string): string | undefined {
  const stripped = stripLineComments(sql);
  const match = stripped.match(/[A-Za-z_][A-Za-z0-9_]*/);
  return match === null ? undefined : match[0].toUpperCase();
}

function stripLineComments(sql: string): string {
  // Strip block comments first so that a leading `/* DELETE FROM x */` doesn't
  // smuggle a deny-listed keyword past the lexer, and so that pure-comment
  // recipes (block-comment only, no actual SQL) trip the empty-recipe check.
  // Greedy-but-non-overlapping match; doesn't try to track nested comments
  // (SQLite doesn't support them) or escape sequences inside strings (recipes
  // mixing block comments with string literals are vanishingly rare and the
  // runtime PRAGMA query_only=1 backstop catches anything that slips by).
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

/**
 * Strip `--` line comments and trailing whitespace; return true if nothing
 * meaningful remains.
 */
function isEffectivelyEmpty(sql: string): boolean {
  return stripLineComments(sql).trim().length === 0;
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    // Strip leading Markdown header markers so "# Fan-out" → "Fan-out".
    return trimmed.replace(/^#+\s+/, "");
  }
  return undefined;
}

/**
 * Hand-rolled YAML frontmatter parser scoped to codemap's recipe needs.
 * Reads one optional `actions` list of RecipeAction-shaped items between
 * `---` delimiters at the top of the file. Per plan §9 Q-D: recipe-specific
 * shallow shape only; reject anything weirder so authors get clear errors
 * instead of half-parsed YAML edge cases.
 *
 * Returns the parsed actions (or undefined when the file has no
 * frontmatter / no actions key) plus the body — file content with the
 * frontmatter block stripped, used as the description body downstream.
 */
export function extractFrontmatterAndBody(md: string): {
  actions: RecipeAction[] | undefined;
  body: string;
} {
  // Frontmatter must start at byte 0 with three dashes + newline (LF or
  // CRLF); anything else is treated as plain Markdown.
  const startMatch = md.match(/^---\r?\n/);
  if (startMatch === null) {
    return { actions: undefined, body: md };
  }
  const afterStart = md.slice(startMatch[0].length);
  const endMatch = afterStart.match(/\n---\r?\n/);
  if (endMatch === null) {
    return { actions: undefined, body: md };
  }
  const fmText = afterStart.slice(0, endMatch.index);
  const body = afterStart.slice(endMatch.index! + endMatch[0].length);
  const actions = parseActionsFromFrontmatter(fmText);
  return { actions, body };
}

// Parses the actions block from the frontmatter text. Strict shape — one
// top-level "actions" key whose value is a list of items with a required
// "type" field plus optional "auto_fixable" (boolean) and "description"
// (string). Returns undefined when no actions key is found. Other top-level
// keys are tolerated (forward-compat for future recipe metadata).
function parseActionsFromFrontmatter(fm: string): RecipeAction[] | undefined {
  const lines = fm.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (keyMatch !== null && keyMatch[1] === "actions") {
      return parseActionList(lines, i + 1);
    }
    i++;
  }
  return undefined;
}

function parseActionList(lines: string[], startIdx: number): RecipeAction[] {
  const out: RecipeAction[] = [];
  let i = startIdx;
  let current: RecipeAction | undefined;

  while (i < lines.length) {
    const line = lines[i]!;
    // Stop at the next top-level YAML key (no leading whitespace + colon).
    if (/^[A-Za-z_]/.test(line)) break;

    // List-item start (e.g. "  - type: foo").
    const itemMatch = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    if (itemMatch !== null) {
      if (current !== undefined) out.push(current);
      const [, key, raw] = itemMatch;
      const value = parseScalar(raw!);
      current = applyKey({ type: "" }, key!, value);
      i++;
      continue;
    }

    // Continuation key on the same item (e.g. "    description: foo").
    const contMatch = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (contMatch !== null && current !== undefined) {
      const [, key, raw] = contMatch;
      current = applyKey(current, key!, parseScalar(raw!));
      i++;
      continue;
    }

    // Anything else is unrecognised — stop parsing this list and let
    // downstream surface it as "actions block had unexpected content"
    // if we ever need stricter errors. For now, terminate cleanly.
    break;
  }

  if (current !== undefined) out.push(current);
  // Filter out items missing required `type` field (defensive — strict
  // YAML would error here, but we fail open on malformed entries).
  return out.filter((a) => a.type.length > 0);
}

function parseScalar(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  // Strip surrounding quotes (single or double).
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function applyKey(
  action: RecipeAction,
  key: string,
  value: string | boolean,
): RecipeAction {
  const next = { ...action };
  if (key === "type" && typeof value === "string") next.type = value;
  else if (key === "auto_fixable" && typeof value === "boolean")
    next.auto_fixable = value;
  else if (key === "description" && typeof value === "string")
    next.description = value;
  // Unknown keys silently ignored (forward-compat).
  return next;
}
