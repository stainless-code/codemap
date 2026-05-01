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
 * `[]` if the directory doesn't exist (project-recipes case in Tracer 3 —
 * absence of `.codemap/recipes/` is not an error). Throws if the directory
 * exists but a `<id>.sql` fails the load-time validation (Tracer 5 will
 * extend this with the DML/DDL lexical check).
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
    if (isEffectivelyEmpty(sql)) {
      throw new Error(
        `Recipe "${id}" at ${sqlPath} is empty (no SQL after stripping -- comments and whitespace).`,
      );
    }

    const mdPath = join(dir, `${id}.md`);
    const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : undefined;
    const description = md !== undefined ? firstNonEmptyLine(md) : undefined;

    recipes.push({
      id,
      sql,
      description,
      body: md,
      // Tracer 5 will populate this from YAML frontmatter on `md`.
      actions: undefined,
      source,
      shadows: false,
    });
  }

  return recipes.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Strip `--` line comments and trailing whitespace; return true if nothing
 * meaningful remains. Same shape the load-time DML/DDL check (Tracer 5)
 * will extend.
 */
function isEffectivelyEmpty(sql: string): boolean {
  const stripped = sql
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("--");
      return commentIdx === -1 ? line : line.slice(0, commentIdx);
    })
    .join("\n")
    .trim();
  return stripped.length === 0;
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
