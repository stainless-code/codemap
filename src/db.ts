import { openCodemapDatabase } from "./sqlite-db";
import type { CodemapDatabase, BindValues } from "./sqlite-db";

/** Bump on any DDL change; `createSchema()` auto-rebuilds on mismatch. */
export const SCHEMA_VERSION = 10;

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
      complexity REAL
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
      re_export_source TEXT
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
      content TEXT NOT NULL
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
      callee_name TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source, file_path);
    CREATE INDEX IF NOT EXISTS idx_imports_resolved ON imports(resolved_path, file_path);
    CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path);

    CREATE INDEX IF NOT EXISTS idx_exports_name ON exports(name, file_path, kind, is_default);
    CREATE INDEX IF NOT EXISTS idx_exports_file ON exports(file_path);

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

    CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_calls_scope ON calls(caller_scope, file_path, callee_name);
    CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_name, file_path);
    CREATE INDEX IF NOT EXISTS idx_calls_file ON calls(file_path);

    -- Mirrors the typical join shape symbols.(file_path, name, line_start).
    -- The (file_path, name) prefix also covers GROUP BY file_path scans
    -- used by the bundled files-by-coverage recipe (D2 + D13).
    CREATE INDEX IF NOT EXISTS idx_coverage_file_name ON coverage(file_path, name);
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
    DROP TABLE IF EXISTS calls;
    DROP TABLE IF EXISTS suppressions;
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
}

const BATCH_SIZE = 500;

function batchInsert<T>(
  db: CodemapDatabase,
  items: T[],
  sqlPrefix: string,
  one: string,
  extract: (item: T, out: BindValues) => void,
) {
  if (items.length === 0) return;
  const fullPlaceholders = Array(BATCH_SIZE).fill(one).join(",");
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, items.length);
    const batchLen = end - i;
    const placeholders =
      batchLen === BATCH_SIZE
        ? fullPlaceholders
        : Array(batchLen).fill(one).join(",");
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
    "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity)",
    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
}

export function insertExports(db: CodemapDatabase, exports: ExportRow[]) {
  batchInsert(
    db,
    exports,
    "INSERT INTO exports (file_path, name, kind, is_default, re_export_source)",
    "(?,?,?,?,?)",
    (e, v) =>
      v.push(e.file_path, e.name, e.kind, e.is_default, e.re_export_source),
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
}

export function insertMarkers(db: CodemapDatabase, markers: MarkerRow[]) {
  batchInsert(
    db,
    markers,
    "INSERT INTO markers (file_path, line_number, kind, content)",
    "(?,?,?,?)",
    (m, v) => v.push(m.file_path, m.line_number, m.kind, m.content),
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
}

export function insertCalls(db: CodemapDatabase, calls: CallRow[]) {
  batchInsert(
    db,
    calls,
    "INSERT INTO calls (file_path, caller_name, caller_scope, callee_name)",
    "(?,?,?,?)",
    (c, v) => v.push(c.file_path, c.caller_name, c.caller_scope, c.callee_name),
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
