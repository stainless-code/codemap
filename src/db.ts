import { openCodemapDatabase } from "./sqlite-db";
import type { CodemapDatabase, BindValues } from "./sqlite-db";

/**
 * Bump in lockstep with `createTables` / `createIndexes` whenever on-disk schema
 * changes. `createSchema()` rebuilds automatically on version mismatch.
 */
export const SCHEMA_VERSION = 2;

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
      size INTEGER,
      line_count INTEGER,
      language TEXT,
      last_modified INTEGER,
      indexed_at INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      signature TEXT,
      is_exported INTEGER DEFAULT 0,
      is_default_export INTEGER DEFAULT 0,
      members TEXT,
      doc_comment TEXT,
      value TEXT,
      parent_name TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      source TEXT NOT NULL,
      resolved_path TEXT,
      specifiers TEXT,
      is_type_only INTEGER DEFAULT 0,
      line_number INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT,
      is_default INTEGER DEFAULT 0,
      re_export_source TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      props_type TEXT,
      hooks_used TEXT,
      is_default_export INTEGER DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS dependencies (
      from_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      to_path TEXT NOT NULL,
      PRIMARY KEY (from_path, to_path)
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      line_number INTEGER,
      kind TEXT NOT NULL,
      content TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      value TEXT,
      scope TEXT,
      line_number INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_module INTEGER DEFAULT 0,
      line_number INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS css_keyframes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
      name TEXT NOT NULL,
      line_number INTEGER
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
      is_optional INTEGER DEFAULT 0,
      is_readonly INTEGER DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    ) STRICT, WITHOUT ROWID;
  `);
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

export function deleteFileData(db: CodemapDatabase, filePath: string) {
  db.run("DELETE FROM files WHERE path = ?", [filePath]);
}

/**
 * One row in the `files` table — the header for every indexed file. All other
 * row types reference `path` (FK with `ON DELETE CASCADE`). `content_hash` is
 * SHA-256 hex from `src/hash.ts` and drives incremental staleness detection.
 *
 * Schema: see [docs/architecture.md § `files`](../docs/architecture.md#files--every-indexed-file-strict).
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
 * One row in the `symbols` table — top-level or nested function / const / class
 * / interface / type / enum / method / property / getter / setter. Class
 * members carry `parent_name`. JSDoc tags (`@deprecated`, `@internal`, etc.)
 * live in `doc_comment` and power the `deprecated-symbols` /
 * `visibility-tags` recipes.
 *
 * Schema: see [docs/architecture.md § `symbols`](../docs/architecture.md#symbols--functions-constants-classes-interfaces-types-enums-strict).
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
    "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name)",
    "(?,?,?,?,?,?,?,?,?,?,?,?)",
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
      ),
  );
}

/**
 * One row in the `imports` table — a raw `import` statement. `specifiers` is a
 * JSON-encoded string array. `resolved_path` is non-null only when the
 * resolver could map `source` to a file inside the indexed set (see
 * `dependencies` for the resolved edge view).
 *
 * Schema: see [docs/architecture.md § `imports`](../docs/architecture.md#imports--import-statements-strict).
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
 * One row in the `exports` table — named, default, or re-export. `kind` is one
 * of `value` / `type` / `re-export`; `re_export_source` is non-null only for
 * `re-export` rows.
 *
 * Schema: see [docs/architecture.md § `exports`](../docs/architecture.md#exports--export-declarations-strict).
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
 * One row in the `components` table — React component detected by PascalCase
 * name plus JSX return or hook usage. `hooks_used` is a JSON-encoded string
 * array (e.g. `'["useState","useEffect"]'`). PascalCase functions in `.tsx`
 * that neither return JSX nor call hooks are stored as `symbols` only, never
 * as `components`.
 *
 * Schema: see [docs/architecture.md § `components`](../docs/architecture.md#components--react-components-detected-by-pascalcase--jsx-return-or-hook-usage-strict).
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
 * One row in the `dependencies` table — a resolved file-to-file edge derived
 * from `imports.resolved_path`. Self-edges and unresolved imports are
 * excluded. `(from_path, to_path)` is the composite primary key
 * (`STRICT, WITHOUT ROWID`).
 *
 * Schema: see [docs/architecture.md § `dependencies`](../docs/architecture.md#dependencies--resolved-file-to-file-dependency-graph-strict-without-rowid).
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
 * One row in the `markers` table — a `TODO` / `FIXME` / `HACK` / `NOTE` comment
 * extracted from any indexed file (TS, CSS, Markdown, JSON, YAML, …).
 * `content` is the comment text without the marker prefix.
 *
 * Schema: see [docs/architecture.md § `markers`](../docs/architecture.md#markers--todofixmehacknote-comments-extracted-from-all-file-types-strict).
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

/**
 * One row in the `css_variables` table — a CSS custom property
 * (`--token: value`). `scope` is `:root`, `@theme` (Tailwind v4), or the
 * selector text where the property was declared.
 *
 * Schema: see [docs/architecture.md § `css_variables`](../docs/architecture.md#css_variables--css-custom-properties-design-tokens-strict).
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
 * One row in the `css_classes` table — a class name extracted from a CSS
 * selector (without the leading `.`). `is_module` is `1` when the file ends
 * in `.module.css` (CSS Modules — names are usually rewritten by bundlers).
 *
 * Schema: see [docs/architecture.md § `css_classes`](../docs/architecture.md#css_classes--css-class-definitions-strict).
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

/**
 * One row in the `css_keyframes` table — a `@keyframes <name>` declaration.
 *
 * Schema: see [docs/architecture.md § `css_keyframes`](../docs/architecture.md#css_keyframes--keyframes-animation-definitions-strict).
 */
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
 * One row in the `calls` table — a function-scoped call edge, deduped per
 * `(caller_scope, callee_name)` per file. `caller_scope` is the dot-joined
 * enclosing scope (e.g. `UserService.run`) so same-named methods in different
 * classes stay distinct. Module-level calls (outside any function) are
 * intentionally excluded.
 *
 * Schema: see [docs/architecture.md § `calls`](../docs/architecture.md#calls--function-scoped-call-edges-deduped-per-file-strict).
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
 * One row in the `type_members` table — a property or method signature on an
 * interface or object-literal type alias. `symbol_name` references the parent
 * `symbols.name`; `type` is the raw annotation string (or `null` when the
 * parser cannot reconstruct it).
 *
 * Schema: see [docs/architecture.md § `type_members`](../docs/architecture.md#type_members--properties-and-methods-of-interfaces-and-object-literal-types-strict).
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
