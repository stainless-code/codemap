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
 * One bundled recipe: id, human description, SQL, and optional per-row actions
 * (canonical source for CLI, `--recipes-json`, and the JSON output enrichment).
 */
export interface QueryRecipeCatalogEntry {
  id: string;
  description: string;
  sql: string;
  actions?: RecipeAction[];
}

/**
 * Bundled read-only SQL for `codemap query --recipe <id>`. Keys match **`codemap query --help`**.
 *
 * `actions` (optional) is appended to each row in `--json` output so agents see
 * the recommended follow-up alongside the data. Add an `actions` array on a
 * recipe only when there's a concrete next step the agent should consider for
 * every row — counts-by-kind and similar aggregates intentionally omit it.
 */
export const QUERY_RECIPES: Record<
  string,
  { sql: string; description: string; actions?: RecipeAction[] }
> = {
  "fan-out": {
    description: "Top 10 files by dependency fan-out (edge count)",
    sql: `SELECT from_path, COUNT(*) AS deps
FROM dependencies
GROUP BY from_path
ORDER BY deps DESC, from_path ASC
LIMIT 10`,
    actions: [
      {
        type: "review-coupling",
        description:
          "High fan-out usually means orchestrator role; consider extracting helpers or splitting responsibilities.",
      },
    ],
  },
  "fan-out-sample": {
    description:
      "Top 10 by fan-out, plus up to five sample dependency targets per file",
    sql: `SELECT d.from_path,
  COUNT(*) AS deps,
  (SELECT GROUP_CONCAT(to_path, ' | ')
   FROM (SELECT to_path FROM dependencies d2 WHERE d2.from_path = d.from_path ORDER BY to_path ASC LIMIT 5))
    AS sample_targets
FROM dependencies d
GROUP BY d.from_path
ORDER BY deps DESC, d.from_path ASC
LIMIT 10`,
  },
  /**
   * Same ranking as `fan-out-sample`, but sample targets as a JSON array (SQLite JSON1
   * `json_group_array`). Prefer `fan-out-sample` if JSON1 is unavailable.
   */
  "fan-out-sample-json": {
    description:
      "Like fan-out-sample, but sample_targets is a JSON array (requires JSON1)",
    sql: `SELECT d.from_path,
  COUNT(*) AS deps,
  (SELECT json_group_array(to_path)
   FROM (SELECT to_path FROM dependencies d2 WHERE d2.from_path = d.from_path ORDER BY to_path ASC LIMIT 5))
    AS sample_targets
FROM dependencies d
GROUP BY d.from_path
ORDER BY deps DESC, d.from_path ASC
LIMIT 10`,
  },
  /**
   * Files most imported/depended-on (complement to fan-out).
   */
  "fan-in": {
    description: "Top 15 files by fan-in (how many other files depend on them)",
    sql: `SELECT to_path, COUNT(*) AS fan_in
FROM dependencies
GROUP BY to_path
ORDER BY fan_in DESC, to_path ASC
LIMIT 15`,
    actions: [
      {
        type: "review-stability",
        description:
          "High fan-in: changes here ripple through many consumers. Protect with tests before refactoring.",
      },
    ],
  },
  "index-summary": {
    description:
      "Single row: row counts for main tables (quick health snapshot)",
    sql: `SELECT
  (SELECT COUNT(*) FROM files) AS files,
  (SELECT COUNT(*) FROM symbols) AS symbols,
  (SELECT COUNT(*) FROM imports) AS imports,
  (SELECT COUNT(*) FROM components) AS components,
  (SELECT COUNT(*) FROM dependencies) AS dependencies`,
  },
  "files-largest": {
    description: "Top 20 files by line count (size/complexity hotspots)",
    sql: `SELECT path, line_count, size, language
FROM files
ORDER BY line_count DESC, path ASC
LIMIT 20`,
    actions: [
      {
        type: "split-file",
        description:
          "Files this large are typical refactor candidates. Look for cohesive sub-modules to extract.",
      },
    ],
  },
  /**
   * Hook count uses comma tally + 1 on the stored JSON array (Codemap emits flat
   * `["useFoo","useBar"]` shapes). Avoids SQLite JSON1 (`json_array_length`) so
   * the recipe runs on any SQLite build the CLI already supports.
   */
  "components-by-hooks": {
    description:
      "React components with the most hooks (comma count on stored JSON array)",
    sql: `SELECT name, file_path,
  CASE
    WHEN hooks_used IS NULL OR trim(hooks_used) = '' OR trim(hooks_used) = '[]' THEN 0
    ELSE (length(hooks_used) - length(replace(hooks_used, ',', ''))) + 1
  END AS hook_count
FROM components
ORDER BY hook_count DESC, file_path ASC, name ASC
LIMIT 20`,
  },
  "markers-by-kind": {
    description: "Marker counts by kind (TODO, FIXME, …)",
    sql: `SELECT kind, COUNT(*) AS count
FROM markers
GROUP BY kind
ORDER BY count DESC, kind ASC`,
  },
  /**
   * Symbols documented with `@deprecated` in their leading JSDoc. Useful for
   * agents to flag callers of soon-to-be-removed APIs before suggesting changes.
   */
  "deprecated-symbols": {
    description:
      "Symbols whose JSDoc contains @deprecated (caller-warning candidates)",
    sql: `SELECT name, kind, file_path, line_start, signature, doc_comment
FROM symbols
WHERE doc_comment LIKE '%@deprecated%'
ORDER BY file_path ASC, line_start ASC
LIMIT 50`,
    actions: [
      {
        type: "flag-caller",
        description:
          "Warn before suggesting changes that depend on this symbol; check callers via the calls table.",
      },
    ],
  },
  /**
   * Symbols carrying JSDoc visibility tags (`@internal`, `@private`, `@alpha`,
   * `@beta`). Useful for agents to know what is *not* part of the public API
   * before suggesting imports or extending re-exports.
   */
  "visibility-tags": {
    description:
      "Symbols carrying a JSDoc visibility tag (public / private / internal / alpha / beta)",
    sql: `SELECT name, kind, visibility, file_path, line_start, signature, doc_comment
FROM symbols
WHERE visibility IS NOT NULL
ORDER BY file_path ASC, line_start ASC
LIMIT 100`,
    actions: [
      {
        type: "flag-non-public",
        description:
          "Treat as not part of the public API unless visibility = 'public': don't import from package consumers; check the visibility tag before extending re-exports.",
      },
    ],
  },
  /**
   * All indexed file paths with their content hash. Powers the \`codemap validate\`
   * CLI: callers diff this list against on-disk content to detect stale entries
   * without paying to re-read every file.
   */
  "files-hashes": {
    description:
      "All indexed files with content_hash (input for staleness checks)",
    sql: `SELECT path, content_hash, language, line_count
FROM files
ORDER BY path ASC`,
  },
  /**
   * "Barrel" candidates — files that re-export a lot. High export count can
   * indicate either an intentional public API surface or accidental fan-out;
   * agents can use it to decide whether a new export should land here or stay local.
   */
  "barrel-files": {
    description:
      "Top 20 files by export count (barrel / public-API candidates)",
    sql: `SELECT file_path, COUNT(*) AS exports
FROM exports
GROUP BY file_path
ORDER BY exports DESC, file_path ASC
LIMIT 20`,
    actions: [
      {
        type: "split-barrel",
        description:
          "Confirm this is an intentional public-API surface; if it's accidental fan-out, consider splitting into smaller barrels.",
      },
    ],
  },
};

/**
 * Sorted recipe ids (same set as {@link QUERY_RECIPES}).
 */
export function listQueryRecipeIds(): string[] {
  return Object.keys(QUERY_RECIPES).sort();
}

/**
 * Full catalog for **`codemap query --recipes-json`** — derived from {@link QUERY_RECIPES} only.
 */
export function listQueryRecipeCatalog(): QueryRecipeCatalogEntry[] {
  return listQueryRecipeIds().map((id) => {
    const meta = QUERY_RECIPES[id]!;
    const entry: QueryRecipeCatalogEntry = {
      id,
      description: meta.description,
      sql: meta.sql,
    };
    if (meta.actions !== undefined) entry.actions = meta.actions;
    return entry;
  });
}

/**
 * Returns the SQL string for a recipe id, or `undefined` if unknown.
 */
export function getQueryRecipeSql(id: string): string | undefined {
  return QUERY_RECIPES[id]?.sql;
}

/**
 * Returns the per-row {@link RecipeAction} template for a recipe id, or
 * `undefined` if the recipe is unknown OR carries no actions. Recipe-only:
 * ad-hoc SQL never gets actions.
 */
export function getQueryRecipeActions(id: string): RecipeAction[] | undefined {
  return QUERY_RECIPES[id]?.actions;
}
