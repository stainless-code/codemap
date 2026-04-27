/**
 * One bundled recipe: id, human description, and SQL (canonical source for CLI and `--recipes-json`).
 */
export interface QueryRecipeCatalogEntry {
  id: string;
  description: string;
  sql: string;
}

/**
 * Bundled read-only SQL for `codemap query --recipe <id>`. Keys match **`codemap query --help`**.
 */
export const QUERY_RECIPES: Record<
  string,
  { sql: string; description: string }
> = {
  "fan-out": {
    description: "Top 10 files by dependency fan-out (edge count)",
    sql: `SELECT from_path, COUNT(*) AS deps
FROM dependencies
GROUP BY from_path
ORDER BY deps DESC, from_path ASC
LIMIT 10`,
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
  },
  /**
   * Symbols carrying JSDoc visibility tags (`@internal`, `@private`, `@alpha`,
   * `@beta`). Useful for agents to know what is *not* part of the public API
   * before suggesting imports or extending re-exports.
   */
  "visibility-tags": {
    description:
      "Symbols tagged @internal / @private / @alpha / @beta in JSDoc",
    sql: `SELECT name, kind, file_path, line_start, signature, doc_comment
FROM symbols
WHERE doc_comment LIKE '%@internal%'
   OR doc_comment LIKE '%@private%'
   OR doc_comment LIKE '%@alpha%'
   OR doc_comment LIKE '%@beta%'
ORDER BY file_path ASC, line_start ASC
LIMIT 100`,
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
    return { id, description: meta.description, sql: meta.sql };
  });
}

/**
 * Returns the SQL string for a recipe id, or `undefined` if unknown.
 */
export function getQueryRecipeSql(id: string): string | undefined {
  return QUERY_RECIPES[id]?.sql;
}
