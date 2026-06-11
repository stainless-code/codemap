/**
 * Server-side source of the "full" skill / rule markdown that
 * `codemap skill` / `codemap rule` and `codemap://skill` /
 * `codemap://rule` return. Lives at `templates/agent-content/<kind>/*.md`
 * — separate from `templates/agents/{rules,skills}/` because the latter
 * is written to consumer disk by `agents init`, while these stay inside
 * the published package and feed the live fetch surface.
 *
 * Section files are concatenated in lexical name order (joined with a
 * blank line), so a numeric prefix (`00-`, `10-`, `20-`) controls
 * section order. Future bullets replace the single `00-full.md` files
 * with multiple sections, including `*.gen.md` ones generated from the
 * live recipe catalog / schema DDL.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-template-path";
import { createTables } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { listQueryRecipeCatalog } from "./query-recipes";

export type AgentContentKind = "skill" | "rule";

/**
 * Bump when the shape of the pointer files in
 * `templates/agents/{rules/codemap,skills/codemap/SKILL}.md` changes
 * (frontmatter schema, fetch instructions, etc.) — not when the
 * full content served by `codemap skill` / `codemap rule` changes.
 * Should fire roughly once a year, not per release.
 */
export const EXPECTED_POINTER_VERSION = 1;

/** Root directory containing per-kind subdirs (`skill/`, `rule/`). */
export function resolveAgentContentDir(): string {
  // `resolveAgentsTemplateDir()` already handles dev/dist path resolution
  // (single `..` after `dirname(import.meta.url)`); siblinged to it.
  return join(resolveAgentsTemplateDir(), "..", "agent-content");
}

const MCP_INSTRUCTIONS_FILE = "mcp-instructions.md";
const MCP_RECIPE_REFS_RE = /<!--\s*codemap-mcp-recipe-refs:\s*([^>]+?)-->/;

/** MCP initialize playbook — `templates/agent-content/mcp-instructions.md`. */
export function assembleMcpInstructions(appendix?: string): string {
  const path = join(resolveAgentContentDir(), MCP_INSTRUCTIONS_FILE);
  const base = readFileSync(path, "utf8").trimEnd() + "\n";
  if (appendix === undefined || appendix === "") return base;
  return base + appendix;
}

/** Recipe ids declared in the MCP instructions machine-ref comment. */
export function extractMcpInstructionRecipeIds(content: string): string[] {
  const match = content.match(MCP_RECIPE_REFS_RE);
  if (match === null) return [];
  return match[1]!
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Renderer registry — keyed by `<kind>/<filename>`. Files ending in
 * `.gen.md` are treated as generated content: if a renderer is
 * registered for the path, its output replaces the on-disk file body.
 * The on-disk file still controls section ordering (lexical) and can
 * carry a hand-written fallback for environments where the renderer's
 * data source is unavailable.
 */
const RENDERERS: Record<string, () => string> = {
  "skill/20-recipes.gen.md": renderRecipesSection,
  "skill/30-schema.gen.md": renderSchemaSection,
};

function isGeneratedSection(kind: AgentContentKind, name: string): boolean {
  return name.endsWith(".gen.md") && `${kind}/${name}` in RENDERERS;
}

function renderSection(
  kind: AgentContentKind,
  name: string,
  path: string,
): string {
  if (isGeneratedSection(kind, name)) {
    return RENDERERS[`${kind}/${name}`]!().trimEnd();
  }
  return readFileSync(path, "utf8").trimEnd();
}

/** Section names for `kind`, sorted lexically. */
function listSectionNames(kind: AgentContentKind): string[] {
  const dir = join(resolveAgentContentDir(), kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/**
 * Assemble the full markdown for `kind` by concatenating every section
 * in lexical order (joined with a blank line). Cheap enough to call
 * per request — caches live one level up (`resource-handlers.ts`).
 * `*.gen.md` sections route to a registered renderer; plain `.md`
 * sections are read verbatim from disk.
 */
export function assembleAgentContent(kind: AgentContentKind): string {
  const dir = join(resolveAgentContentDir(), kind);
  const sections = listSectionNames(kind).map((name) =>
    renderSection(kind, name, join(dir, name)),
  );
  return sections.join("\n\n") + "\n";
}

/**
 * Markdown table of every bundled (and, when the runtime is up, project-local)
 * recipe — id, description, params. Reflects the live catalog so adding a
 * recipe automatically surfaces it in `codemap skill` without any template
 * edit. Pure formatter; no DB needed (catalog is loaded from disk).
 */
function renderRecipesSection(): string {
  const entries = listQueryRecipeCatalog();
  const lines: string[] = [];
  lines.push("## Recipe catalog (auto-generated)");
  lines.push("");
  lines.push(
    "Every recipe id you can pass to `codemap query --recipe <id>`. Rendered from the live on-disk catalog at assembly time (`codemap skill` every call; MCP/HTTP `codemap://skill` memoizes the assembled body per server process).",
  );
  lines.push("");
  lines.push("| id | source | params | description |");
  lines.push("| --- | --- | --- | --- |");
  for (const e of entries) {
    const params =
      e.params && e.params.length > 0
        ? e.params.map((p) => `\`${p.name}\``).join(", ")
        : "—";
    const desc = e.description.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| \`${e.id}\` | ${e.source}${e.shadows ? " (shadows bundled)" : ""} | ${params} | ${desc} |`,
    );
  }
  lines.push("");
  lines.push(
    "Run `codemap query --recipes-json` for the JSON catalog (includes SQL bodies + per-row `actions` templates + recency fields).",
  );
  return lines.join("\n");
}

/** Convenience: `assembleAgentContent("skill")`. Kept for callsite locality. */
export function assembleSkill(): string {
  return assembleAgentContent("skill");
}

/** Convenience: `assembleAgentContent("rule")`. Kept for callsite locality. */
export function assembleRule(): string {
  return assembleAgentContent("rule");
}

/**
 * Result of scanning one consumer-disk pointer file (a no-such-file
 * outcome is not represented — the caller's loop simply skips it).
 */
export interface PointerStatus {
  path: string;
  presentVersion: number | null;
  /** True when stamp is missing AND file is fat enough to look like the legacy thick template (pre-pointer protocol). */
  looksLegacy: boolean;
}

// Pre-pointer SKILL.md was 660 lines and rule.md was 248. Anything
// substantially smaller is either the new pointer or a user-managed
// file we shouldn't nag about.
const LEGACY_FAT_LINE_THRESHOLD = 50;
const POINTER_VERSION_RE = /<!--\s*codemap-pointer-version:\s*(\d+)\s*-->/;

function scanPointer(path: string): PointerStatus | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const match = text.match(POINTER_VERSION_RE);
  const presentVersion = match ? Number(match[1]) : null;
  const looksLegacy =
    presentVersion === null &&
    text.split("\n").length > LEGACY_FAT_LINE_THRESHOLD;
  return { path, presentVersion, looksLegacy };
}

/** Inspect every consumer-disk pointer file rooted at `root`. */
export function checkConsumerPointers(root: string): PointerStatus[] {
  const candidates = [
    join(root, ".agents", "skills", "codemap", "SKILL.md"),
    join(root, ".agents", "rules", "codemap.md"),
  ];
  return candidates
    .map(scanPointer)
    .filter((s): s is PointerStatus => s !== undefined);
}

/**
 * Print a one-line stderr nag for each stale pointer found under
 * `root`. Stamp present and < expected → nag. Stamp absent but file
 * looks like the legacy thick template → nag. Stamp absent and short
 * → silent (user-managed override).
 *
 * Caller invokes once per process at startup; verbs that pipe stdout
 * (`codemap skill > file.md`) are unaffected because the warning goes
 * to stderr.
 */
export function maybeWarnStalePointers(root: string): void {
  for (const s of checkConsumerPointers(root)) {
    const stamped = s.presentVersion !== null;
    if (stamped && s.presentVersion! >= EXPECTED_POINTER_VERSION) continue;
    if (!stamped && !s.looksLegacy) continue;
    const got = stamped ? `v${s.presentVersion}` : "no stamp (legacy template)";
    console.error(
      `codemap: ${s.path} pointer protocol ${got} != expected v${EXPECTED_POINTER_VERSION}. Re-run \`codemap agents init --force\` to refresh.`,
    );
  }
}

// DDL is static at compile time — render once per process, reuse forever.
let schemaSectionCache: string | undefined;

/**
 * Markdown enumeration of every table created by `createTables()`,
 * sourced from the live DDL: opens an in-memory SQLite, runs the same
 * `createTables` codemap uses for real indexes, then reads
 * `sqlite_schema`. Adding a table / column in `db.ts` propagates here
 * automatically — no separate schema doc to keep in sync.
 */
function renderSchemaSection(): string {
  if (schemaSectionCache !== undefined) return schemaSectionCache;
  const db = openCodemapDatabase(":memory:");
  let rows: { name: string; sql: string | null }[];
  try {
    createTables(db);
    rows = db
      .query(
        "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string; sql: string | null }[];
  } finally {
    db.close();
  }
  const lines: string[] = [];
  lines.push("## Schema reference (auto-generated)");
  lines.push("");
  lines.push(
    "Every table in `.codemap/index.db`. Sourced from the live `createTables()` DDL in `src/db.ts`; rendered at assembly time (`codemap skill` every call; MCP/HTTP `codemap://skill` memoizes per server process).",
  );
  lines.push("");
  for (const r of rows) {
    if (r.sql === null) continue;
    lines.push(`### \`${r.name}\``);
    lines.push("");
    lines.push("```sql");
    lines.push(r.sql.trim());
    lines.push("```");
    lines.push("");
  }
  schemaSectionCache = lines.join("\n").trimEnd();
  return schemaSectionCache;
}
