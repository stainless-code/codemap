-- Frozen DDL from main @ SCHEMA_VERSION 27 (for v27→34 rebuild tests in db.test.ts).

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
      nesting_depth INTEGER
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
      column_end INTEGER NOT NULL
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
