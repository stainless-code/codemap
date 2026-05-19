import { openCodemapDatabase } from "./sqlite-db";
import type { CodemapDatabase, BindValues } from "./sqlite-db";

/** Bump only on rebuild-forcing DDL changes (NOT on additive tables/columns).
 *  See `docs/architecture.md` § Schema Versioning. */
export const SCHEMA_VERSION = 29;

/**
 * `meta` key tracking the FTS5 state at the last reindex; mismatch with the
 * current resolved config triggers a forced `--full` rebuild
 * (`docs/plans/fts5-mermaid.md` Q3).
 */
export const META_FTS5_ENABLED_KEY = "fts5_enabled";

export type { CodemapDatabase };

export function openDb(): CodemapDatabase {
  return openCodemapDatabase();
}

export function closeDb(db: CodemapDatabase, opts?: { readonly?: boolean }) {
  try {
    if (!opts?.readonly) {
      db.run("PRAGMA analysis_limit = 400");
      db.run("PRAGMA optimize");
    }
  } finally {
    db.close();
  }
}

export function createTables(db: CodemapDatabase) {
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      language TEXT NOT NULL,
      last_modified INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      signature TEXT NOT NULL,
      is_exported INTEGER NOT NULL DEFAULT 0,
      is_default_export INTEGER NOT NULL DEFAULT 0,
      members TEXT,
      doc_comment TEXT,
      value TEXT,
      parent_name TEXT,
      visibility TEXT,
      complexity REAL,
      name_column_start INTEGER NOT NULL DEFAULT 0,
      name_column_end INTEGER NOT NULL DEFAULT 0,
      scope_local_id INTEGER NOT NULL DEFAULT 0,
      body_line_count INTEGER,
      param_count INTEGER,
      nesting_depth INTEGER,
      return_type TEXT,
      is_async INTEGER NOT NULL DEFAULT 0,
      is_generator INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    -- One row per indexed file. Pure counters from the AST walk.
    -- Joins to files(path).
    CREATE TABLE IF NOT EXISTS file_metrics (
      file_path TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
      total_lines INTEGER NOT NULL,
      code_lines INTEGER NOT NULL,
      blank_lines INTEGER NOT NULL,
      comment_lines INTEGER NOT NULL,
      let_count INTEGER NOT NULL DEFAULT 0,
      const_count INTEGER NOT NULL DEFAULT 0,
      var_count INTEGER NOT NULL DEFAULT 0,
      function_count INTEGER NOT NULL DEFAULT 0,
      arrow_count INTEGER NOT NULL DEFAULT 0,
      class_count INTEGER NOT NULL DEFAULT 0,
      interface_count INTEGER NOT NULL DEFAULT 0,
      export_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      source TEXT NOT NULL,
      resolved_path TEXT,
      specifiers TEXT NOT NULL,
      is_type_only INTEGER NOT NULL DEFAULT 0,
      line_number INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      re_export_source TEXT,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      is_re_export INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      props_type TEXT,
      hooks_used TEXT NOT NULL,
      is_default_export INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS dependencies (
      from_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      to_path TEXT NOT NULL,
      PRIMARY KEY (from_path, to_path)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      column_start INTEGER NOT NULL DEFAULT 0,
      column_end INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      value TEXT,
      scope TEXT NOT NULL,
      line_number INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_module INTEGER NOT NULL DEFAULT 0,
      line_number INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_keyframes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      line_number INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      caller_name TEXT NOT NULL,
      caller_scope TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      args_count INTEGER,
      is_method_call INTEGER NOT NULL DEFAULT 0,
      is_constructor_call INTEGER NOT NULL DEFAULT 0,
      is_optional_chain INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS type_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      symbol_name TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      is_optional INTEGER NOT NULL DEFAULT 0,
      is_readonly INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    -- Lexical scope graph per R.11. Block/for/catch deferred — body refs
    -- resolve to the enclosing function/method scope (conservative escape
    -- valve). local_id is parser-assigned so refs avoid SQLite rowid
    -- round-trips.
    CREATE TABLE IF NOT EXISTS scopes (
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      local_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('module','function','arrow','class','method','interface','type-alias','for','catch')),
      parent_local_id INTEGER,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      owner_symbol_name TEXT,
      PRIMARY KEY (file_path, local_id)
    ) STRICT, WITHOUT ROWID;

    -- Identifier USEs per R.11 (kinds: value/type/jsx). is_write per R.13.
    -- Compound assign emits two rows, declaration-with-init emits write
    -- only. scope_local_id joins scopes(local_id), 0 = module.
    CREATE TABLE IF NOT EXISTS "references" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('value','type','jsx','member')),
      scope_local_id INTEGER NOT NULL DEFAULT 0,
      is_write INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    -- Per R.12. resolved_symbol_id NULL when is_external/global/unresolved.
    -- Re-export chain walk defers to Tier 6.
    CREATE TABLE IF NOT EXISTS bindings (
      reference_id INTEGER PRIMARY KEY REFERENCES "references"(id) ON DELETE CASCADE,
      resolved_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
      resolution_kind TEXT NOT NULL CHECK (resolution_kind IN (
        'same-file','imported','global','unresolved'
      )),
      is_external INTEGER NOT NULL DEFAULT 0
    ) STRICT, WITHOUT ROWID;

    -- Test suite metadata: describe / it / test / suite blocks with
    -- their hierarchy + skip/only/todo flags. framework is detected
    -- from imports (vitest / jest / bun-test / node-test / mocha) and
    -- defaults to 'unknown' when no test framework import is found
    -- in the file. parent_suite_id is NULL for top-level blocks.
    CREATE TABLE IF NOT EXISTS test_suites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('describe','it','test','suite','context')),
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      parent_suite_id INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
      is_skipped INTEGER NOT NULL DEFAULT 0,
      is_only INTEGER NOT NULL DEFAULT 0,
      is_todo INTEGER NOT NULL DEFAULT 0,
      framework TEXT NOT NULL CHECK (framework IN ('vitest','jest','bun-test','node-test','mocha','unknown'))
    ) STRICT;

    -- Runtime markers — operational signals worth auditing: console
    -- calls, debugger statements, raw throws, process.env reads. detail
    -- is the qualifier (console.log → 'log', throw → expression text,
    -- process.env.X → 'X').
    CREATE TABLE IF NOT EXISTS runtime_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('console','debugger','throw','process-env')),
      line_start INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      detail TEXT,
      scope_local_id INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    -- First-class parameter rows: one row per leaf parameter binding,
    -- ordered by position. Keyed by (file_path, owner_name, owner_kind)
    -- to disambiguate same-name functions vs methods in the same file.
    -- type_text is the stringified annotation. default_text is the raw
    -- default expression source (NULL when there is no default).
    CREATE TABLE IF NOT EXISTS function_params (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      owner_name TEXT NOT NULL,
      owner_kind TEXT NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      type_text TEXT,
      default_text TEXT,
      is_rest INTEGER NOT NULL DEFAULT 0,
      is_optional INTEGER NOT NULL DEFAULT 0,
      line_start INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL
    ) STRICT;

    -- Materialised re-export chains. One row per (from_file, from_name)
    -- pointing at the terminal definition site after walking through
    -- barrel files (bounded at 10 hops). Same engine as bindings-engine
    -- exposes the walk to ad-hoc SQL.
    CREATE TABLE IF NOT EXISTS re_export_chains (
      from_file TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      from_name TEXT NOT NULL,
      to_file TEXT NOT NULL,
      to_name TEXT NOT NULL,
      hops INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_file, from_name)
    ) STRICT, WITHOUT ROWID;

    -- Strongly-connected component (SCC) of the import dependency graph.
    -- Only cyclic files appear here. Files sharing cycle_id import each
    -- other directly or transitively. Computed via Tarjan's SCC on
    -- dependencies after the full index pass.
    CREATE TABLE IF NOT EXISTS module_cycles (
      file_path TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
      cycle_id INTEGER NOT NULL,
      cycle_size INTEGER NOT NULL
    ) STRICT;

    -- Per-specifier breakdown of imports.specifiers JSON blob. Recipes that
    -- want specifier-precise rewrites (rename specifier, dedupe, type-only
    -- migrate) JOIN this table. The original imports.specifiers JSON stays
    -- in place as a v1 convenience surface.
    CREATE TABLE IF NOT EXISTS import_specifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      source TEXT NOT NULL,
      line INTEGER NOT NULL,
      column_start INTEGER NOT NULL,
      column_end INTEGER NOT NULL,
      imported_name TEXT NOT NULL,
      local_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('named','default','namespace')),
      is_type_only INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    -- Opt-in suppressions — recipes LEFT JOIN to honor, ad-hoc SQL unaffected.
    -- line_number > 0 = next-line scope (suppressed line). 0 = file scope.
    -- Sourced from // codemap-ignore-{next-line,file} <recipe-id> directives (see markers.ts).
    CREATE TABLE IF NOT EXISTS suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      line_number INTEGER NOT NULL,
      recipe_id TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    ) STRICT, WITHOUT ROWID;

    -- User-data table: query result snapshots for --save-baseline / --baseline.
    -- Lives next to the index tables so the entire codemap state is one SQLite file
    -- (no parallel JSON files / new gitignore entries). Intentionally absent from
    -- dropAll() so --full and SCHEMA_VERSION rebuilds preserve baselines (only
    -- index tables get dropped). Future schema bumps that change THIS tables shape
    -- need an in-place migration rather than relying on the schema-mismatch rebuild.
    CREATE TABLE IF NOT EXISTS query_baselines (
      name TEXT PRIMARY KEY,
      recipe_id TEXT,
      sql TEXT NOT NULL,
      rows_json TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      git_ref TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;

    -- User-data table: static coverage snapshots ingested via codemap ingest-coverage
    -- (Istanbul coverage-final.json + LCOV lcov.info, written by every modern test
    -- runner). Joins to symbols on the natural key (file_path, name, line_start) —
    -- intentionally NOT a FK to symbols.id, because dropAll() drops symbols on every
    -- --full reindex and the recreated rows get fresh AUTOINCREMENT ids. Natural-key
    -- rows survive that churn. Like query_baselines, intentionally excluded from
    -- dropAll() so a --full rebuild doesn't nuke the user's last ingest. Orphan
    -- cleanup (file deleted from project) lives at the end of every ingest in
    -- application/coverage-engine.ts, not here. See docs/plans/coverage-ingestion.md
    -- (D6) for the unwind on why CASCADE was rejected.
    CREATE TABLE IF NOT EXISTS coverage (
      file_path        TEXT    NOT NULL,
      name             TEXT    NOT NULL,
      line_start       INTEGER NOT NULL,
      coverage_pct     REAL,
      hit_statements   INTEGER NOT NULL,
      total_statements INTEGER NOT NULL,
      PRIMARY KEY (file_path, name, line_start)
    ) STRICT, WITHOUT ROWID;

    -- User-data table: per-recipe last_run_at + run_count for agent-host
    -- ranking. Joined inline into --recipes-json / codemap://recipes via
    -- loadRecipeRecency. Like query_baselines / coverage, intentionally absent
    -- from dropAll() so --full and SCHEMA_VERSION rebuilds preserve activity
    -- history. 90-day window is eager-on-write (recordRecipeRun DELETEs stale
    -- rows before its upsert) — reads stay pure. recipe_id is loose (no FK,
    -- can match bundled or project recipe ids). See docs/architecture.md.
    CREATE TABLE IF NOT EXISTS recipe_recency (
      recipe_id   TEXT PRIMARY KEY,
      last_run_at INTEGER NOT NULL,
      run_count   INTEGER NOT NULL DEFAULT 1
    ) STRICT, WITHOUT ROWID;

    -- Config-derived: reconcileBoundaryRules clears and re-fills from
    -- .codemap/config boundaries on every index pass. Dropped on --full
    -- like the other index tables (unlike query_baselines / coverage which
    -- are user data and persist). Joined against dependencies by the
    -- bundled boundary-violations recipe.
    CREATE TABLE IF NOT EXISTS boundary_rules (
      name      TEXT PRIMARY KEY,
      from_glob TEXT NOT NULL,
      to_glob   TEXT NOT NULL,
      action    TEXT NOT NULL CHECK (action IN ('deny', 'allow'))
    ) STRICT, WITHOUT ROWID;
  `);

  // Separate statement: FTS5 virtual-table CREATE doesn't accept STRICT and
  // can't live inside the createTables block above. Always-create (empty when
  // disabled) so toggling fts5: false → true needs only a --full, not a
  // schema bump. Tokeniser per `docs/plans/fts5-mermaid.md` Q1.
  db.run(
    `CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(
      file_path UNINDEXED,
      content,
      tokenize = 'porter unicode61'
    )`,
  );
}

/**
 * Upsert one file's source into `source_fts`. DELETE + INSERT because FTS5
 * virtual tables don't support `INSERT OR REPLACE`. Caller gates on the
 * FTS5 toggle.
 */
export function upsertSourceFts(
  db: CodemapDatabase,
  filePath: string,
  content: string,
) {
  db.run("DELETE FROM source_fts WHERE file_path = ?", [filePath]);
  db.run("INSERT INTO source_fts (file_path, content) VALUES (?, ?)", [
    filePath,
    content,
  ]);
}

/**
 * `source_fts` isn't FK-linked to `files` (FTS5 virtual tables can't be FK
 * targets), so CASCADE doesn't reach it — incremental-delete callers must
 * mirror the DELETE explicitly.
 */
export function deleteSourceFts(db: CodemapDatabase, filePath: string) {
  db.run("DELETE FROM source_fts WHERE file_path = ?", [filePath]);
}

/**
 * Batch-delete FTS5 rows via `WHERE file_path IN (?, …)` — FTS5 accepts
 * arbitrary `DELETE … WHERE` predicates (only INSERT/UPDATE have shape constraints).
 */
export function deleteSourceFtsBatch(db: CodemapDatabase, filePaths: string[]) {
  if (filePaths.length === 0) return;
  const placeholders = filePaths.map(() => "?").join(",");
  db.run(
    `DELETE FROM source_fts WHERE file_path IN (${placeholders})`,
    filePaths,
  );
}

export function clearSourceFts(db: CodemapDatabase) {
  db.run("DELETE FROM source_fts");
}

export function createIndexes(db: CodemapDatabase) {
  db.run(`
    -- Covering indexes: include columns returned by common queries to avoid table lookups
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name, kind, file_path, line_start, line_end, signature, is_exported);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind, is_exported, name, file_path);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);

    -- Partial indexes: subset indexes for common filtered AI agent queries
    CREATE INDEX IF NOT EXISTS idx_symbols_exported ON symbols(name, kind, file_path, signature)
      WHERE is_exported = 1;
    CREATE INDEX IF NOT EXISTS idx_symbols_functions ON symbols(name, file_path, line_start, line_end, signature)
      WHERE kind = 'function';
    CREATE INDEX IF NOT EXISTS idx_symbols_visibility ON symbols(visibility, file_path, name, line_start)
      WHERE visibility IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_symbols_async ON symbols(file_path, name, return_type)
      WHERE is_async = 1;

    CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source, file_path);
    CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_path, file_path);
    CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path);

    CREATE INDEX IF NOT EXISTS idx_exports_name ON exports(name, file_path, kind, is_default);
    CREATE INDEX IF NOT EXISTS idx_exports_file ON exports(file_path);
    CREATE INDEX IF NOT EXISTS idx_exports_position ON exports(file_path, line_start);
    CREATE INDEX IF NOT EXISTS idx_exports_re_export ON exports(is_re_export, file_path);

    CREATE INDEX IF NOT EXISTS idx_components_name ON components(name, file_path, props_type, hooks_used);
    CREATE INDEX IF NOT EXISTS idx_components_file ON components(file_path, name);

    -- WITHOUT ROWID tables already have a clustered PK — this covers reverse lookups
    CREATE INDEX IF NOT EXISTS idx_dependencies_to ON dependencies(to_path, from_path);

    CREATE INDEX IF NOT EXISTS idx_markers_kind ON markers(kind, file_path, line_number, content);
    CREATE INDEX IF NOT EXISTS idx_markers_file ON markers(file_path);

    -- Suppressions: most recipe LEFT JOINs key on (recipe_id, file_path[, line_number]).
    CREATE INDEX IF NOT EXISTS idx_suppressions_lookup ON suppressions(recipe_id, file_path, line_number);
    CREATE INDEX IF NOT EXISTS idx_suppressions_file ON suppressions(file_path);

    CREATE INDEX IF NOT EXISTS idx_css_variables_name ON css_variables(name, value, scope, file_path);
    CREATE INDEX IF NOT EXISTS idx_css_variables_file ON css_variables(file_path);
    CREATE INDEX IF NOT EXISTS idx_css_classes_name ON css_classes(name, file_path, is_module);
    CREATE INDEX IF NOT EXISTS idx_css_classes_file ON css_classes(file_path);
    CREATE INDEX IF NOT EXISTS idx_css_keyframes_name ON css_keyframes(name, file_path);

    CREATE INDEX IF NOT EXISTS idx_type_members_symbol ON type_members(symbol_name, file_path, name, type, is_optional, is_readonly);
    CREATE INDEX IF NOT EXISTS idx_type_members_file ON type_members(file_path);

    CREATE INDEX IF NOT EXISTS idx_scopes_parent ON scopes(file_path, parent_local_id);
    CREATE INDEX IF NOT EXISTS idx_scopes_kind ON scopes(kind, file_path);
    CREATE INDEX IF NOT EXISTS idx_scopes_owner ON scopes(owner_symbol_name, file_path);

    CREATE INDEX IF NOT EXISTS idx_references_name ON "references"(name, file_path);
    CREATE INDEX IF NOT EXISTS idx_references_file ON "references"(file_path, line_start);
    CREATE INDEX IF NOT EXISTS idx_references_kind ON "references"(kind, file_path);
    CREATE INDEX IF NOT EXISTS idx_references_writes ON "references"(name, is_write) WHERE is_write = 1;

    CREATE INDEX IF NOT EXISTS idx_bindings_resolved ON bindings(resolved_symbol_id);
    CREATE INDEX IF NOT EXISTS idx_bindings_kind ON bindings(resolution_kind);

    CREATE INDEX IF NOT EXISTS idx_module_cycles_cid ON module_cycles(cycle_id);
    CREATE INDEX IF NOT EXISTS idx_module_cycles_size ON module_cycles(cycle_size);

    CREATE INDEX IF NOT EXISTS idx_re_export_chains_to ON re_export_chains(to_file, to_name);
    CREATE INDEX IF NOT EXISTS idx_re_export_chains_truncated ON re_export_chains(truncated) WHERE truncated = 1;

    CREATE INDEX IF NOT EXISTS idx_function_params_owner ON function_params(file_path, owner_name);
    CREATE INDEX IF NOT EXISTS idx_function_params_name ON function_params(name);
    CREATE INDEX IF NOT EXISTS idx_function_params_type ON function_params(type_text) WHERE type_text IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_runtime_markers_kind ON runtime_markers(kind);
    CREATE INDEX IF NOT EXISTS idx_runtime_markers_file ON runtime_markers(file_path);
    CREATE INDEX IF NOT EXISTS idx_runtime_markers_detail ON runtime_markers(detail) WHERE detail IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_test_suites_file ON test_suites(file_path);
    CREATE INDEX IF NOT EXISTS idx_test_suites_kind ON test_suites(kind);
    CREATE INDEX IF NOT EXISTS idx_test_suites_parent ON test_suites(parent_suite_id);
    CREATE INDEX IF NOT EXISTS idx_test_suites_skipped ON test_suites(is_skipped) WHERE is_skipped = 1;

    CREATE INDEX IF NOT EXISTS idx_import_specifiers_imported ON import_specifiers(imported_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_import_specifiers_local ON import_specifiers(local_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_import_specifiers_file ON import_specifiers(file_path, line);
    CREATE INDEX IF NOT EXISTS idx_import_specifiers_source ON import_specifiers(source, file_path);

    CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_calls_scope ON calls(caller_scope, file_path, callee_name);
    CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_calls_file ON calls(file_path);
    CREATE INDEX IF NOT EXISTS idx_calls_position ON calls(file_path, line_start);

    -- Mirrors the typical join shape symbols.(file_path, name, line_start).
    -- The (file_path, name) prefix also covers GROUP BY file_path scans
    -- used by the bundled files-by-coverage recipe (D2 + D13).
    CREATE INDEX IF NOT EXISTS idx_coverage_file_name ON coverage(file_path, name);

    -- Powers the lazy 90-day prune (DELETE WHERE last_run_at < cutoff) inside
    -- loadRecipeRecency. Tiny table (one row per known recipe id) — index keeps
    -- the prune predictable as project-recipe counts grow.
    CREATE INDEX IF NOT EXISTS idx_recipe_recency_last_run ON recipe_recency(last_run_at);
  `);
}

export function createSchema(db: CodemapDatabase) {
  const hasMeta = db
    .query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
    )
    .get();
  if (hasMeta) {
    const row = db
      .query<{ value: string }>("SELECT value FROM meta WHERE key = ?")
      .get("schema_version");
    if (row && row.value !== String(SCHEMA_VERSION)) {
      console.log(
        `  Schema version mismatch (${row.value} -> ${SCHEMA_VERSION}), rebuilding...`,
      );
      dropAll(db);
    }
  }

  createTables(db);
  createIndexes(db);
  setMeta(db, "schema_version", String(SCHEMA_VERSION));
}

export function dropAll(db: CodemapDatabase) {
  db.run(`
    DROP TABLE IF EXISTS module_cycles;
    DROP TABLE IF EXISTS re_export_chains;
    DROP TABLE IF EXISTS function_params;
    DROP TABLE IF EXISTS runtime_markers;
    DROP TABLE IF EXISTS test_suites;
    DROP TABLE IF EXISTS file_metrics;
    DROP TABLE IF EXISTS bindings;
    DROP TABLE IF EXISTS "references";
    DROP TABLE IF EXISTS calls;
    DROP TABLE IF EXISTS suppressions;
    DROP TABLE IF EXISTS scopes;
    DROP TABLE IF EXISTS import_specifiers;
    DROP TABLE IF EXISTS type_members;
    DROP TABLE IF EXISTS dependencies;
    DROP TABLE IF EXISTS markers;
    DROP TABLE IF EXISTS components;
    DROP TABLE IF EXISTS imports;
    DROP TABLE IF EXISTS exports;
    DROP TABLE IF EXISTS symbols;
    DROP TABLE IF EXISTS css_variables;
    DROP TABLE IF EXISTS css_classes;
    DROP TABLE IF EXISTS css_keyframes;
    DROP TABLE IF EXISTS source_fts;
    DROP TABLE IF EXISTS boundary_rules;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS meta;
  `);
}

export function getMeta(db: CodemapDatabase, key: string): string | undefined {
  const row = db
    .query<{ value: string }>("SELECT value FROM meta WHERE key = ?")
    .get(key);
  return row?.value;
}

export function setMeta(db: CodemapDatabase, key: string, value: string) {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
    key,
    value,
  ]);
}

/** One row in `boundary_rules`. Shape mirrors the Zod `boundaries` field. */
export interface BoundaryRuleRow {
  name: string;
  from_glob: string;
  to_glob: string;
  action: "deny" | "allow";
}

/**
 * Replace `boundary_rules` with `rules` — config is the single source of
 * truth, this table is a denormalised lookup. Idempotent; cheap (one row
 * per declared boundary).
 *
 * Atomic via SAVEPOINT: a duplicate `name` (PRIMARY KEY collision — Zod
 * doesn't dedupe) would otherwise wipe the previous good state and leave
 * the table half-populated. SAVEPOINT works inside or outside an open
 * transaction, so callers don't need to coordinate.
 */
export function reconcileBoundaryRules(
  db: CodemapDatabase,
  rules: ReadonlyArray<BoundaryRuleRow>,
) {
  db.run("SAVEPOINT reconcile_boundary_rules");
  try {
    db.run("DELETE FROM boundary_rules");
    for (const rule of rules) {
      db.run(
        "INSERT INTO boundary_rules (name, from_glob, to_glob, action) VALUES (?, ?, ?, ?)",
        [rule.name, rule.from_glob, rule.to_glob, rule.action],
      );
    }
    db.run("RELEASE SAVEPOINT reconcile_boundary_rules");
  } catch (error) {
    db.run("ROLLBACK TO SAVEPOINT reconcile_boundary_rules");
    db.run("RELEASE SAVEPOINT reconcile_boundary_rules");
    throw error;
  }
}

export function deleteFileData(db: CodemapDatabase, filePath: string) {
  db.run("DELETE FROM files WHERE path = ?", [filePath]);
}

/**
 * Header row for every indexed file; all other rows FK `file_path` here with
 * `ON DELETE CASCADE`. `content_hash` is SHA-256 hex (see `src/hash.ts`) and
 * drives incremental staleness detection + the `files-hashes` recipe.
 */
export interface FileRow {
  path: string;
  content_hash: string;
  size: number;
  line_count: number;
  language: string;
  last_modified: number;
  indexed_at: number;
}

export function insertFile(db: CodemapDatabase, file: FileRow) {
  db.run(
    `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      file.path,
      file.content_hash,
      file.size,
      file.line_count,
      file.language,
      file.last_modified,
      file.indexed_at,
    ],
  );
}

/**
 * Function / const / class / interface / type / enum, plus class members
 * (`method` / `property` / `getter` / `setter`) — class members carry
 * `parent_name`. JSDoc tags in `doc_comment` power the `deprecated-symbols`
 * and `visibility-tags` recipes; `members` is JSON for enums.
 */
export interface SymbolRow {
  file_path: string;
  name: string;
  kind: string;
  line_start: number;
  line_end: number;
  signature: string;
  is_exported: number;
  is_default_export: number;
  members: string | null;
  doc_comment: string | null;
  value: string | null;
  parent_name: string | null;
  /**
   * JSDoc visibility tag: `public` / `private` / `internal` / `alpha` / `beta`.
   * Null when the doc has no visibility tag (or no doc at all). First match
   * in document order wins when multiple tags are present.
   */
  visibility: string | null;
  /**
   * Cyclomatic complexity (1 + branching nodes). Function-shaped symbols
   * only; `null` for non-function kinds (interfaces, types, enums, plain
   * consts) and for symbols without a walked body. Optional for back-
   * compat with callers that built `SymbolRow` literals before the
   * column existed; absence binds as `null`.
   */
  complexity?: number | null;
  /** 0-based byte column of the symbol-name token start on `line_start` (per [R.6]). Optional for back-compat; defaults to 0. */
  name_column_start?: number;
  /** 0-based byte column one past the symbol-name token end. Optional for back-compat; defaults to 0. */
  name_column_end?: number;
  /** Scope where the NAME is declared (parent of the body's own scope). Joins scopes.local_id. Defaults to 0 (module). */
  scope_local_id?: number;
  /** Body line count (line_end - line_start + 1) for function-shaped symbols. NULL otherwise. */
  body_line_count?: number | null;
  /** Param count for function-shaped symbols. NULL otherwise. */
  param_count?: number | null;
  /** Max nesting depth (conditionals/loops/ternaries) for function-shaped symbols. NULL otherwise. */
  nesting_depth?: number | null;
  /** Stringified return type for function-shaped symbols; NULL when unannotated or N/A. */
  return_type?: string | null;
  /** 1 for async function-shaped symbols. */
  is_async?: number;
  /** 1 for generator function-shaped symbols. */
  is_generator?: number;
}

// SQLite 3.32+ (2020+) default; bun:sqlite + better-sqlite3 12.x both ship
// with newer SQLite. Older builds default to 999.
const SQLITE_MAX_VARS = 32766;
// Cap rows per batch even when col_count would allow more — keeps per-batch
// JS allocations bounded and avoids pathologically long SQL strings.
const MAX_ROWS_PER_BATCH = 5000;

// Memo per (one, count) tuple — collapses tail-batch placeholder rebuilds (and the
// resulting unique SQL strings hitting stmtCache) to O(1) cache hits.
const placeholderCache = new Map<string, Map<number, string>>();

function getPlaceholders(one: string, count: number): string {
  let perOne = placeholderCache.get(one);
  if (perOne === undefined) {
    perOne = new Map();
    placeholderCache.set(one, perOne);
  }
  let s = perOne.get(count);
  if (s === undefined) {
    s = Array(count).fill(one).join(",");
    perOne.set(count, s);
  }
  return s;
}

// Memo per `one` (placeholder shape per table) so col-count + batch-size
// math runs once per table, not per call.
const batchSizeCache = new Map<string, number>();

function batchSizeForTuple(one: string): number {
  let n = batchSizeCache.get(one);
  if (n !== undefined) return n;
  let cols = 0;
  // Count `?` chars — placeholder shape is "(?,?,?,...)"; one row's params.
  for (let i = 0; i < one.length; i++) if (one.charCodeAt(i) === 63) cols++;
  n = Math.min(
    MAX_ROWS_PER_BATCH,
    Math.floor(SQLITE_MAX_VARS / Math.max(cols, 1)),
  );
  batchSizeCache.set(one, n);
  return n;
}

function batchInsert<T>(
  db: CodemapDatabase,
  items: T[],
  sqlPrefix: string,
  one: string,
  extract: (item: T, out: BindValues) => void,
) {
  if (items.length === 0) return;
  // Per-table cap: narrow tables (4-col bindings) batch up to 5000 rows;
  // wide tables (20-col symbols) batch up to floor(32766/20) = 1638. Both
  // are much higher than the pre-2026-05 fixed 500 → fewer round-trips
  // through the bun:sqlite / better-sqlite3 binding boundary.
  const batchSize = batchSizeForTuple(one);
  for (let i = 0; i < items.length; i += batchSize) {
    const end = Math.min(i + batchSize, items.length);
    const batchLen = end - i;
    const placeholders = getPlaceholders(one, batchLen);
    const values: BindValues = [];
    for (let j = i; j < end; j++) {
      extract(items[j], values);
    }
    db.run(`${sqlPrefix} VALUES ${placeholders}`, values);
  }
}

export function insertSymbols(db: CodemapDatabase, symbols: SymbolRow[]) {
  batchInsert(
    db,
    symbols,
    "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity, name_column_start, name_column_end, scope_local_id, body_line_count, param_count, nesting_depth, return_type, is_async, is_generator)",
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (s, v) =>
      v.push(
        s.file_path,
        s.name,
        s.kind,
        s.line_start,
        s.line_end,
        s.signature,
        s.is_exported,
        s.is_default_export,
        s.members,
        s.doc_comment,
        s.value,
        s.parent_name,
        s.visibility,
        s.complexity ?? null,
        s.name_column_start ?? 0,
        s.name_column_end ?? 0,
        s.scope_local_id ?? 0,
        s.body_line_count ?? null,
        s.param_count ?? null,
        s.nesting_depth ?? null,
        s.return_type ?? null,
        s.is_async ?? 0,
        s.is_generator ?? 0,
      ),
  );
}

/**
 * Raw `import` statement. `specifiers` is JSON; `resolved_path` is null when
 * the resolver couldn't map `source` to an indexed file (see `dependencies`
 * for the resolved edge view).
 */
export interface ImportRow {
  file_path: string;
  source: string;
  resolved_path: string | null;
  specifiers: string;
  is_type_only: number;
  line_number: number;
}

export function insertImports(db: CodemapDatabase, imports: ImportRow[]) {
  batchInsert(
    db,
    imports,
    "INSERT INTO imports (file_path, source, resolved_path, specifiers, is_type_only, line_number)",
    "(?,?,?,?,?,?)",
    (imp, v) =>
      v.push(
        imp.file_path,
        imp.source,
        imp.resolved_path,
        imp.specifiers,
        imp.is_type_only,
        imp.line_number,
      ),
  );
}

/**
 * Named, default, or re-export. `kind` is `value` / `type` / `re-export`;
 * `re_export_source` is non-null only for `re-export` rows.
 */
export interface ExportRow {
  file_path: string;
  name: string;
  kind: string;
  is_default: number;
  re_export_source: string | null;
  /** 1-based line of the exported name token (per [R.6]). */
  line_start: number;
  /** 1-based line of the export statement end (for multi-line exports). */
  line_end: number;
  /** 0-based byte column of the exported name token start. */
  column_start: number;
  /** 0-based byte column one past the exported name token end. */
  column_end: number;
  /** 1 when the export is `export … from 'mod'` (has `re_export_source`). */
  is_re_export: number;
}

export function insertExports(db: CodemapDatabase, exports: ExportRow[]) {
  batchInsert(
    db,
    exports,
    "INSERT INTO exports (file_path, name, kind, is_default, re_export_source, line_start, line_end, column_start, column_end, is_re_export)",
    "(?,?,?,?,?,?,?,?,?,?)",
    (e, v) =>
      v.push(
        e.file_path,
        e.name,
        e.kind,
        e.is_default,
        e.re_export_source,
        e.line_start,
        e.line_end,
        e.column_start,
        e.column_end,
        e.is_re_export,
      ),
  );
}

/**
 * React component (PascalCase + JSX return or hook usage). `hooks_used` is
 * JSON, e.g. `'["useState","useEffect"]'`. PascalCase functions that neither
 * return JSX nor call hooks stay in `symbols` only.
 */
export interface ComponentRow {
  file_path: string;
  name: string;
  props_type: string | null;
  hooks_used: string;
  is_default_export: number;
}

export function insertComponents(
  db: CodemapDatabase,
  components: ComponentRow[],
) {
  batchInsert(
    db,
    components,
    "INSERT INTO components (file_path, name, props_type, hooks_used, is_default_export)",
    "(?,?,?,?,?)",
    (c, v) =>
      v.push(
        c.file_path,
        c.name,
        c.props_type,
        c.hooks_used,
        c.is_default_export,
      ),
  );
}

/**
 * Resolved file-to-file edge derived from `imports.resolved_path`. Composite
 * PK `(from_path, to_path)`; self-edges and unresolved imports are excluded.
 */
export interface DependencyRow {
  from_path: string;
  to_path: string;
}

export function insertDependencies(db: CodemapDatabase, deps: DependencyRow[]) {
  batchInsert(
    db,
    deps,
    "INSERT OR IGNORE INTO dependencies (from_path, to_path)",
    "(?,?)",
    (d, v) => v.push(d.from_path, d.to_path),
  );
}

/**
 * `TODO` / `FIXME` / `HACK` / `NOTE` comment from any indexed file (TS, CSS,
 * Markdown, JSON, YAML, …). `content` excludes the marker prefix.
 */
export interface MarkerRow {
  file_path: string;
  line_number: number;
  kind: string;
  content: string;
  /** 0-based byte column where the marker tag (e.g. `TODO`) starts. Optional for back-compat. */
  column_start?: number;
  /** 0-based byte column one past the marker tag end. Optional for back-compat. */
  column_end?: number;
}

export function insertMarkers(db: CodemapDatabase, markers: MarkerRow[]) {
  batchInsert(
    db,
    markers,
    "INSERT INTO markers (file_path, line_number, kind, content, column_start, column_end)",
    "(?,?,?,?,?,?)",
    (m, v) =>
      v.push(
        m.file_path,
        m.line_number,
        m.kind,
        m.content,
        m.column_start ?? 0,
        m.column_end ?? 0,
      ),
  );
}

/** Suppression marker; `line_number > 0` = next-line scope, `0` = file scope. See markers.ts + the `suppressions` DDL. */
export interface SuppressionRow {
  file_path: string;
  line_number: number;
  recipe_id: string;
}

export function insertSuppressions(
  db: CodemapDatabase,
  suppressions: SuppressionRow[],
) {
  batchInsert(
    db,
    suppressions,
    "INSERT INTO suppressions (file_path, line_number, recipe_id)",
    "(?,?,?)",
    (s, v) => v.push(s.file_path, s.line_number, s.recipe_id),
  );
}

/**
 * CSS custom property (`--token: value`). `scope` is `:root`, `@theme`
 * (Tailwind v4), or the selector text where the property was declared.
 */
export interface CssVariableRow {
  file_path: string;
  name: string;
  value: string | null;
  scope: string;
  line_number: number;
}

export function insertCssVariables(
  db: CodemapDatabase,
  variables: CssVariableRow[],
) {
  batchInsert(
    db,
    variables,
    "INSERT INTO css_variables (file_path, name, value, scope, line_number)",
    "(?,?,?,?,?)",
    (cv, v) =>
      v.push(cv.file_path, cv.name, cv.value, cv.scope, cv.line_number),
  );
}

/**
 * Class name from a CSS selector (no leading `.`). `is_module = 1` for
 * `.module.css` files (names get rewritten by bundlers).
 */
export interface CssClassRow {
  file_path: string;
  name: string;
  is_module: number;
  line_number: number;
}

export function insertCssClasses(db: CodemapDatabase, classes: CssClassRow[]) {
  batchInsert(
    db,
    classes,
    "INSERT INTO css_classes (file_path, name, is_module, line_number)",
    "(?,?,?,?)",
    (c, v) => v.push(c.file_path, c.name, c.is_module, c.line_number),
  );
}

/** `@keyframes <name>` declaration. */
export interface CssKeyframeRow {
  file_path: string;
  name: string;
  line_number: number;
}

export function insertCssKeyframes(
  db: CodemapDatabase,
  keyframes: CssKeyframeRow[],
) {
  batchInsert(
    db,
    keyframes,
    "INSERT INTO css_keyframes (file_path, name, line_number)",
    "(?,?,?)",
    (k, v) => v.push(k.file_path, k.name, k.line_number),
  );
}

/**
 * Function-scoped call edge, deduped per `(caller_scope, callee_name)` per
 * file. `caller_scope` is the dot-joined enclosing scope (e.g. `UserService.run`)
 * so same-named methods in different classes stay distinct. Module-level
 * calls are excluded.
 */
export interface CallRow {
  file_path: string;
  caller_name: string;
  caller_scope: string;
  callee_name: string;
  /** 1-based line of the callee identifier token (per [R.6]). */
  line_start: number;
  /** 0-based byte column of the callee identifier start. */
  column_start: number;
  /** 0-based byte column one past the callee identifier end. */
  column_end: number;
  /** NULL when the call includes a spread argument. */
  args_count?: number | null;
  is_method_call?: number;
  is_constructor_call?: number;
  is_optional_chain?: number;
}

export function insertCalls(db: CodemapDatabase, calls: CallRow[]) {
  batchInsert(
    db,
    calls,
    "INSERT INTO calls (file_path, caller_name, caller_scope, callee_name, line_start, column_start, column_end, args_count, is_method_call, is_constructor_call, is_optional_chain)",
    "(?,?,?,?,?,?,?,?,?,?,?)",
    (c, v) =>
      v.push(
        c.file_path,
        c.caller_name,
        c.caller_scope,
        c.callee_name,
        c.line_start,
        c.column_start,
        c.column_end,
        c.args_count ?? null,
        c.is_method_call ?? 0,
        c.is_constructor_call ?? 0,
        c.is_optional_chain ?? 0,
      ),
  );
}

/**
 * Lexical scope row per [R.11]. `parent_local_id` is `null` for the
 * module scope; `owner_symbol_name` is `null` for module + arrow scopes.
 */
export interface ScopeRow {
  file_path: string;
  local_id: number;
  kind:
    | "module"
    | "function"
    | "arrow"
    | "class"
    | "method"
    | "interface"
    | "type-alias"
    | "for"
    | "catch";
  parent_local_id: number | null;
  line_start: number;
  line_end: number;
  owner_symbol_name: string | null;
}

/** Identifier use row per [R.11] + [R.13]. */
export interface ReferenceRow {
  file_path: string;
  name: string;
  /** 1-based line of the identifier token. */
  line_start: number;
  column_start: number;
  column_end: number;
  kind: "value" | "type" | "jsx" | "member";
  /** Matches `scopes.local_id` within the same file (`0` = module scope). */
  scope_local_id: number;
  is_write: number;
}

export function insertReferences(db: CodemapDatabase, rows: ReferenceRow[]) {
  batchInsert(
    db,
    rows,
    'INSERT INTO "references" (file_path, name, line_start, column_start, column_end, kind, scope_local_id, is_write)',
    "(?,?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.name,
        r.line_start,
        r.column_start,
        r.column_end,
        r.kind,
        r.scope_local_id,
        r.is_write,
      ),
  );
}

/** Per-reference binding row per [R.12]. */
export interface BindingRow {
  reference_id: number;
  resolved_symbol_id: number | null;
  resolution_kind: "same-file" | "imported" | "global" | "unresolved";
  is_external: number;
}

export function insertBindings(db: CodemapDatabase, rows: BindingRow[]) {
  batchInsert(
    db,
    rows,
    // persistBindings DELETEs orphans first + bindings only runs on full
    // rebuild (table empty after dropAll). No conflicts → plain INSERT.
    "INSERT INTO bindings (reference_id, resolved_symbol_id, resolution_kind, is_external)",
    "(?,?,?,?)",
    (r, v) =>
      v.push(
        r.reference_id,
        r.resolved_symbol_id,
        r.resolution_kind,
        r.is_external,
      ),
  );
}

/**
 * Per-file aggregate metrics row. One row per file. NULL `code_lines` /
 * `comment_lines` for files we don't parse with the AST (rare).
 */
export interface FileMetricsRow {
  file_path: string;
  total_lines: number;
  code_lines: number;
  blank_lines: number;
  comment_lines: number;
  let_count: number;
  const_count: number;
  var_count: number;
  function_count: number;
  arrow_count: number;
  class_count: number;
  interface_count: number;
  export_count: number;
}

export function insertFileMetrics(db: CodemapDatabase, rows: FileMetricsRow[]) {
  batchInsert(
    db,
    rows,
    // Incremental path: deleteFileData(relPath) deletes from `files`, which
    // CASCADEs through file_metrics' FK before insertFileMetrics runs.
    // Full rebuild: table empty after dropAll. No conflicts → plain INSERT.
    "INSERT INTO file_metrics (file_path, total_lines, code_lines, blank_lines, comment_lines, let_count, const_count, var_count, function_count, arrow_count, class_count, interface_count, export_count)",
    "(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.total_lines,
        r.code_lines,
        r.blank_lines,
        r.comment_lines,
        r.let_count,
        r.const_count,
        r.var_count,
        r.function_count,
        r.arrow_count,
        r.class_count,
        r.interface_count,
        r.export_count,
      ),
  );
}

/**
 * One row per leaf parameter binding, ordered by position. Owner-kind
 * lets `(file_path, owner_name, owner_kind)` disambiguate same-name
 * functions vs methods.
 */
export interface FunctionParamRow {
  file_path: string;
  owner_name: string;
  /** 'function' / 'method' / 'arrow' / 'constructor' / 'getter' / 'setter'. */
  owner_kind: string;
  /** 0-based index in the params array. */
  position: number;
  name: string;
  type_text: string | null;
  default_text: string | null;
  is_rest: number;
  is_optional: number;
  line_start: number;
  column_start: number;
  column_end: number;
}

export function insertFunctionParams(
  db: CodemapDatabase,
  rows: FunctionParamRow[],
) {
  batchInsert(
    db,
    rows,
    "INSERT INTO function_params (file_path, owner_name, owner_kind, position, name, type_text, default_text, is_rest, is_optional, line_start, column_start, column_end)",
    "(?,?,?,?,?,?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.owner_name,
        r.owner_kind,
        r.position,
        r.name,
        r.type_text,
        r.default_text,
        r.is_rest,
        r.is_optional,
        r.line_start,
        r.column_start,
        r.column_end,
      ),
  );
}

/**
 * Test suite block — describe / it / test / suite / context with
 * skip/only/todo flags. parent_suite_id stays NULL in the worker output;
 * the orchestrator resolves it after bulk insert (or queries use the
 * line range to infer parent).
 */
export interface TestSuiteRow {
  file_path: string;
  name: string;
  kind: "describe" | "it" | "test" | "suite" | "context";
  line_start: number;
  line_end: number;
  /** Index into the per-file rows array — orchestrator resolves to row id. */
  parent_index: number | null;
  is_skipped: number;
  is_only: number;
  is_todo: number;
  framework: "vitest" | "jest" | "bun-test" | "node-test" | "mocha" | "unknown";
}

export function insertTestSuites(db: CodemapDatabase, rows: TestSuiteRow[]) {
  if (!rows.length) return;
  // Insert in a single transaction; rowids are sequential so the
  // parent_index → real id mapping is `firstId + parent_index`.
  const firstIdRow = db
    .query<{ seq: number | null }>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'test_suites'",
    )
    .get();
  const firstId = (firstIdRow?.seq ?? 0) + 1;
  batchInsert(
    db,
    rows,
    "INSERT INTO test_suites (file_path, name, kind, line_start, line_end, parent_suite_id, is_skipped, is_only, is_todo, framework)",
    "(?,?,?,?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.name,
        r.kind,
        r.line_start,
        r.line_end,
        r.parent_index === null ? null : firstId + r.parent_index,
        r.is_skipped,
        r.is_only,
        r.is_todo,
        r.framework,
      ),
  );
}

/** Operational signal — console.log / debugger / throw / process.env. */
export interface RuntimeMarkerRow {
  file_path: string;
  kind: "console" | "debugger" | "throw" | "process-env";
  line_start: number;
  column_start: number;
  column_end: number;
  /** Qualifier — method name for console, env-var name for process-env, expression text for throw, NULL for debugger. */
  detail: string | null;
  scope_local_id: number;
}

export function insertRuntimeMarkers(
  db: CodemapDatabase,
  rows: RuntimeMarkerRow[],
) {
  batchInsert(
    db,
    rows,
    "INSERT INTO runtime_markers (file_path, kind, line_start, column_start, column_end, detail, scope_local_id)",
    "(?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.kind,
        r.line_start,
        r.column_start,
        r.column_end,
        r.detail,
        r.scope_local_id,
      ),
  );
}

/** Resolved re-export chain — bindings-engine and ad-hoc SQL share this. */
export interface ReExportChainRow {
  from_file: string;
  from_name: string;
  to_file: string;
  to_name: string;
  hops: number;
  /** 1 if the walk hit MAX_REEXPORT_DEPTH without finding a non-re-export terminal. */
  truncated: number;
}

export function insertReExportChains(
  db: CodemapDatabase,
  rows: ReExportChainRow[],
) {
  batchInsert(
    db,
    rows,
    // persistReExportChains DELETEs all rows first. No conflicts → plain INSERT.
    "INSERT INTO re_export_chains (from_file, from_name, to_file, to_name, hops, truncated)",
    "(?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.from_file,
        r.from_name,
        r.to_file,
        r.to_name,
        r.hops,
        r.truncated,
      ),
  );
}

/** Per-file SCC assignment per Tarjan's algorithm. */
export interface ModuleCycleRow {
  file_path: string;
  cycle_id: number;
  cycle_size: number;
}

export function insertModuleCycles(
  db: CodemapDatabase,
  rows: ModuleCycleRow[],
) {
  batchInsert(
    db,
    rows,
    // persistModuleCycles DELETEs all rows first. No conflicts → plain INSERT.
    "INSERT INTO module_cycles (file_path, cycle_id, cycle_size)",
    "(?,?,?)",
    (r, v) => v.push(r.file_path, r.cycle_id, r.cycle_size),
  );
}

export function insertScopes(db: CodemapDatabase, rows: ScopeRow[]) {
  batchInsert(
    db,
    rows,
    "INSERT INTO scopes (file_path, local_id, kind, parent_local_id, line_start, line_end, owner_symbol_name)",
    "(?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.local_id,
        r.kind,
        r.parent_local_id,
        r.line_start,
        r.line_end,
        r.owner_symbol_name,
      ),
  );
}

/**
 * Per-specifier row for `import { foo, bar as baz }` / `import foo from 'mod'`
 * / `import * as ns from 'mod'`. Side-effect imports (`import "mod"`) have
 * no specifiers. JOIN to `imports` by (file_path, line, source) when the
 * import statement's other fields are needed.
 */
export interface ImportSpecifierRow {
  file_path: string;
  source: string;
  line: number;
  /** 0-based byte column of the imported (or local) name token start (per [R.6]). */
  column_start: number;
  column_end: number;
  /** Name as written in the source module (`foo` in `import { foo as bar }`); equals `local_name` when no alias. */
  imported_name: string;
  /** Name as bound locally (`bar` in `import { foo as bar }`); equals `imported_name` when no alias. For default + namespace imports, this is the binding name. */
  local_name: string;
  kind: "named" | "default" | "namespace";
  is_type_only: number;
}

export function insertImportSpecifiers(
  db: CodemapDatabase,
  rows: ImportSpecifierRow[],
) {
  batchInsert(
    db,
    rows,
    "INSERT INTO import_specifiers (file_path, source, line, column_start, column_end, imported_name, local_name, kind, is_type_only)",
    "(?,?,?,?,?,?,?,?,?)",
    (r, v) =>
      v.push(
        r.file_path,
        r.source,
        r.line,
        r.column_start,
        r.column_end,
        r.imported_name,
        r.local_name,
        r.kind,
        r.is_type_only,
      ),
  );
}

/**
 * Property / method signature on an interface or object-literal type.
 * `symbol_name` references the parent `symbols.name`; `type` is null when
 * the parser can't reconstruct the annotation.
 */
export interface TypeMemberRow {
  file_path: string;
  symbol_name: string;
  name: string;
  type: string | null;
  is_optional: number;
  is_readonly: number;
}

export function insertTypeMembers(
  db: CodemapDatabase,
  members: TypeMemberRow[],
) {
  batchInsert(
    db,
    members,
    "INSERT INTO type_members (file_path, symbol_name, name, type, is_optional, is_readonly)",
    "(?,?,?,?,?,?)",
    (m, v) =>
      v.push(
        m.file_path,
        m.symbol_name,
        m.name,
        m.type,
        m.is_optional,
        m.is_readonly,
      ),
  );
}

export function getAllFileHashes(db: CodemapDatabase): Map<string, string> {
  const rows = db
    .query<{ path: string; content_hash: string }>(
      "SELECT path, content_hash FROM files",
    )
    .all();
  const map = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    map.set(rows[i].path, rows[i].content_hash);
  }
  return map;
}

/**
 * Snapshot of a `query --recipe <id>` (or ad-hoc SQL) result, captured by
 * `--save-baseline` and replayed by `--baseline`. `rows_json` is the
 * canonical JSON.stringify of the row array — set-diff happens in JS by
 * stringifying current rows and comparing membership.
 */
export interface QueryBaselineRow {
  name: string;
  recipe_id: string | null;
  sql: string;
  rows_json: string;
  row_count: number;
  git_ref: string | null;
  created_at: number;
}

export function upsertQueryBaseline(
  db: CodemapDatabase,
  baseline: QueryBaselineRow,
) {
  db.run(
    `INSERT INTO query_baselines (name, recipe_id, sql, rows_json, row_count, git_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       recipe_id  = excluded.recipe_id,
       sql        = excluded.sql,
       rows_json  = excluded.rows_json,
       row_count  = excluded.row_count,
       git_ref    = excluded.git_ref,
       created_at = excluded.created_at`,
    [
      baseline.name,
      baseline.recipe_id,
      baseline.sql,
      baseline.rows_json,
      baseline.row_count,
      baseline.git_ref,
      baseline.created_at,
    ],
  );
}

export function getQueryBaseline(
  db: CodemapDatabase,
  name: string,
): QueryBaselineRow | undefined {
  // bun:sqlite returns null for misses; better-sqlite3 returns undefined. Coerce here.
  return (
    db
      .query<QueryBaselineRow>(
        `SELECT name, recipe_id, sql, rows_json, row_count, git_ref, created_at
       FROM query_baselines WHERE name = ?`,
      )
      .get(name) ?? undefined
  );
}

/** Lightweight metadata view of every saved baseline (omits `rows_json`). */
export interface QueryBaselineSummaryRow {
  name: string;
  recipe_id: string | null;
  row_count: number;
  git_ref: string | null;
  created_at: number;
}

export function listQueryBaselines(
  db: CodemapDatabase,
): QueryBaselineSummaryRow[] {
  return db
    .query<QueryBaselineSummaryRow>(
      `SELECT name, recipe_id, row_count, git_ref, created_at
       FROM query_baselines ORDER BY created_at DESC, name ASC`,
    )
    .all();
}

/** @returns true if a baseline with that name was deleted. */
export function deleteQueryBaseline(
  db: CodemapDatabase,
  name: string,
): boolean {
  const before = db
    .query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM query_baselines WHERE name = ?",
    )
    .get(name);
  if (!before || before.n === 0) return false;
  db.run("DELETE FROM query_baselines WHERE name = ?", [name]);
  return true;
}
