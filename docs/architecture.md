# Codemap — Architecture

## Overview

A local SQLite database (`.codemap.db`) indexes the project tree and stores structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers) for SQL queries instead of repeated full-tree scans.

### Runtime and database

**`src/sqlite-db.ts`:** Node uses **`better-sqlite3`**; Bun uses **`bun:sqlite`**. Same schema everywhere. **`src/worker-pool.ts`:** Bun `Worker` or Node `worker_threads`. **Shipped artifact:** **`dist/`** — `package.json` **`bin`** and **`exports`** both point at **`dist/index.mjs`** ([packaging.md](./packaging.md)). Node/Bun matrix notes: [packaging.md § Node vs Bun](./packaging.md#node-vs-bun).

## Layering

| Layer                                        | Role                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`cli.ts`**                                 | Parses argv (`--root`, `--config`, `query`, `agents init`, `--files`, `--full`, `--help`, `version` / `--version`), wires bootstrap → `runCodemapIndex` / `printQueryResult`. |
| **`api.ts`**                                 | Public programmatic surface: `createCodemap()`, `Codemap` (`query`, `index`), re-exports `runCodemapIndex` for advanced use.                                                  |
| **`application/`**                           | Use cases: `run-index.ts` (incremental / full / targeted orchestration), `index-engine.ts` (collect files, git diff, `indexFiles`, workers via `worker-pool.ts`).             |
| **`adapters/`**                              | `LanguageAdapter` registry; built-ins call `parser.ts` / `css-parser.ts` / `markers.ts` from `parse-worker-core`.                                                             |
| **`runtime.ts` / `config.ts` / `db.ts` / …** | Config, SQLite, resolver, workers.                                                                                                                                            |

`index.ts` is the package entry: re-exports the public API and runs `cli.ts` only when executed as the main module (Node/Bun `codemap` binary).

### Full rebuild (parallel)

```
  application/index-engine.ts (main thread)
    │
    ├─ collectFiles()
    │
    ├─ spawn N worker threads ──────────────────────────────────┐
    │                                                           │
    │   ┌─────────────────┐  ┌─────────────────┐       ┌───────▼───────┐
    │   │  Worker 1        │  │  Worker 2        │  ...  │  Worker N     │
    │   │  read + parse    │  │  read + parse    │       │  read + parse │
    │   │  (parse-worker)  │  │  (parse-worker)  │       │  (parse-worker)│
    │   └────────┬─────────┘  └────────┬─────────┘       └───────┬───────┘
    │            │                     │                          │
    │            └─────────────────────┼──────────────────────────┘
    │                                  │ structured results
    │                                  ▼
    ├─ resolve imports (oxc-resolver)
    │
    ├─ bulk INSERT (batched, deferred indexes, sync=OFF)
    │
    ├─ CREATE INDEX (single sorted pass)
    │
    └─ .codemap.db
```

### Incremental / targeted (sequential)

```
  application/index-engine.ts (main thread)
    │
    ├─ git diff / --files
    │
    ├─ for each changed file:
    │     read → parse → resolve → INSERT
    │
    └─ .codemap.db
```

### Parser stack

```
  ┌─────────────┐  ┌───────────────┐  ┌────────────┐
  │ parser.ts   │  │ css-parser.ts │  │ markers.ts │
  │ (oxc-parser)│  │ (lightningcss)│  │ (regex)    │
  └──────┬──────┘  └───────┬───────┘  └─────┬──────┘
         │                 │                 │
  ┌──────▼──────┐          │                 │
  │ resolver.ts │          │                 │
  │(oxc-resolver)│         │                 │
  └──────┬──────┘          │                 │
         └─────────────────┼─────────────────┘
                           │
                    ┌──────▼───────┐
                    │ db.ts +      │
                    │ sqlite-db.ts │
                    └──────────────┘
```

### Language adapters

**`src/adapters/types.ts`** defines **`LanguageAdapter`**: `id`, `extensions`, and **`parse(ctx)`** returning structured rows for the SQLite schema. **`src/adapters/builtin.ts`** registers **TS/JS** (oxc), **CSS** (Lightning CSS), and **text** (markers + configured extensions). **`getAdapterForExtension(ext)`** selects the first matching adapter; unknown extensions fall back to **markers-only** text indexing. Future optional packages can add adapters once a registration API exists (see [roadmap.md](./roadmap.md)).

## Key Files

| File              | Purpose                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `index.ts`        | Package entry — re-exports `api` / `config`, runs CLI when main                                  |
| `cli.ts`          | CLI — argv parsing, `query`, `agents init`, `--files`, `version`, index modes                    |
| `api.ts`          | Programmatic API — `createCodemap`, `Codemap`, `runCodemapIndex`                                 |
| `application/`    | Indexing use cases and engine (`run-index`, `index-engine`, types)                               |
| `worker-pool.ts`  | Parallel parse workers (Bun / Node)                                                              |
| `db.ts`           | SQLite adapter — schema DDL, typed CRUD, connection management                                   |
| `parser.ts`       | TS/TSX/JS/JSX extraction via `oxc-parser` — symbols, imports, exports, components, markers       |
| `css-parser.ts`   | CSS extraction via `lightningcss` — custom properties, classes, keyframes, `@theme` blocks       |
| `resolver.ts`     | Import path resolution via `oxc-resolver` — respects `tsconfig` aliases, builds dependency graph |
| `constants.ts`    | Shared constants — e.g. `LANG_MAP`                                                               |
| `markers.ts`      | Shared marker extraction (`TODO`/`FIXME`/`HACK`/`NOTE`) — used by all parsers                    |
| `parse-worker.ts` | Worker thread entry point — reads, parses, and extracts file data in parallel                    |
| `adapters/`       | `LanguageAdapter` types and built-in TS/CSS/text implementations                                 |
| `parsed-types.ts` | Shared `ParsedFile` shape for workers and adapters                                               |
| `agents-init.ts`  | `codemap agents init` — copies `templates/agents` → `.agents/`                                   |
| `benchmark.ts`    | Performance comparison script — see [benchmark.md](./benchmark.md)                               |

## CLI usage

From an install: `codemap …`. From this repository: `bun src/index.ts …` (same flags).

```bash
# Targeted — re-index only listed paths (relative to project root)
codemap --files path/to/file1.tsx path/to/file2.ts

# Incremental — git-based change detection (or full rebuild when no safe baseline)
codemap

# Full rebuild — drop and recreate index tables
codemap --full

# Query the database (after indexing)
codemap query "SELECT name, file_path FROM symbols LIMIT 20"
```

Timings and methodology: [benchmark.md](./benchmark.md).

### `--files` (targeted reindex)

When specific file paths are passed via `--files`, the indexer skips git diff, git status, and the full filesystem glob scan. It reads the set of already-indexed paths from the database (for import resolution), then only processes the listed files. Files that no longer exist on disk are automatically removed from the index via `ON DELETE CASCADE`.

## Programmatic usage

The npm package exports **`createCodemap`**, **`Codemap`** (`query`, `index`), **`runCodemapIndex`** (advanced), config helpers, **`CodemapDatabase`** (type), adapter types (`LanguageAdapter`, `getAdapterForExtension`, …), and **`ParsedFile`** — see **`src/api.ts`** / **`src/index.ts`** and **`dist/index.d.mts`**. Typical flow:

1. **`await createCodemap({ root, configFile?, config? })`** — loads `codemap.config.*`, calls **`initCodemap`** and **`configureResolver`**.
2. **`await cm.index({ mode, files?, quiet? })`** — same pipeline as the CLI (incremental / full / targeted).
3. **`cm.query(sql)`** — read-only SQL against `.codemap.db` (opens the DB per call).

**Constraint:** `initCodemap` is global to the process; only one active indexed project at a time.

## Schema

**Fingerprints:** incremental runs compare **`files.content_hash`** — SHA-256 hex of raw file bytes from [`src/hash.ts`](../src/hash.ts) (same on Node and Bun). Details in the **`files`** table below.

Current schema version: **2** — see [Schema Versioning](#schema-versioning) for details.

All tables use `STRICT` mode. Tables marked with `WITHOUT ROWID` store data directly in the primary key B-tree. PRAGMAs and index design: [SQLite Performance Configuration](#sqlite-performance-configuration).

### `files` — Every indexed file (`STRICT`)

| Column        | Type    | Description                                    |
| ------------- | ------- | ---------------------------------------------- |
| path          | TEXT PK | Relative path from project root                |
| content_hash  | TEXT    | SHA-256 hex — see **Fingerprints** at § Schema |
| size          | INTEGER | File size in bytes                             |
| line_count    | INTEGER | Total lines                                    |
| language      | TEXT    | `ts`, `tsx`, `css`, `md`, etc.                 |
| last_modified | INTEGER | File mtime (epoch ms)                          |
| indexed_at    | INTEGER | When this row was written                      |

### `symbols` — Functions, variables, classes, interfaces, type aliases, enums (`STRICT`)

| Column            | Type       | Description                                                           |
| ----------------- | ---------- | --------------------------------------------------------------------- |
| id                | INTEGER PK | Auto-increment row id                                                 |
| file_path         | TEXT FK    | References `files(path)` ON DELETE CASCADE                            |
| name              | TEXT       | Symbol name                                                           |
| kind              | TEXT       | `function`, `variable`, `class`, `interface`, `type_alias`, `enum`    |
| line_start        | INTEGER    | Start line (1-based)                                                  |
| line_end          | INTEGER    | End line                                                              |
| signature         | TEXT       | Reconstructed signature (e.g. `usePermissions(): PermissionsContext`) |
| is_exported       | INTEGER    | 1 if exported                                                         |
| is_default_export | INTEGER    | 1 if default export                                                   |

### `imports` — Import statements (`STRICT`)

| Column        | Type       | Description                                            |
| ------------- | ---------- | ------------------------------------------------------ |
| id            | INTEGER PK | Auto-increment row id                                  |
| file_path     | TEXT FK    | File containing the import                             |
| source        | TEXT       | Import specifier (e.g. `~/utils/date`, `react`)        |
| resolved_path | TEXT       | Resolved absolute → relative path (via `oxc-resolver`) |
| specifiers    | TEXT       | JSON array of imported names                           |
| is_type_only  | INTEGER    | 1 if `import type`                                     |
| line_number   | INTEGER    | Line number                                            |

### `exports` — Export declarations (`STRICT`)

| Column           | Type       | Description                  |
| ---------------- | ---------- | ---------------------------- |
| id               | INTEGER PK | Auto-increment row id        |
| file_path        | TEXT FK    | File containing the export   |
| name             | TEXT       | Exported name                |
| kind             | TEXT       | `function`, `variable`, etc. |
| is_default       | INTEGER    | 1 if default export          |
| re_export_source | TEXT       | Source module if re-exported |

### `components` — React components (detected by JSX return + PascalCase) (`STRICT`)

| Column            | Type       | Description                   |
| ----------------- | ---------- | ----------------------------- |
| id                | INTEGER PK | Auto-increment row id         |
| file_path         | TEXT FK    | File containing the component |
| name              | TEXT       | Component name                |
| props_type        | TEXT       | Props type/interface name     |
| hooks_used        | TEXT       | JSON array of hooks called    |
| is_default_export | INTEGER    | 1 if default export           |

### `dependencies` — Resolved file-to-file dependency graph (`STRICT, WITHOUT ROWID`)

| Column    | Type    | Description                |
| --------- | ------- | -------------------------- |
| from_path | TEXT FK | Importing file (PK part 1) |
| to_path   | TEXT    | Imported file (PK part 2)  |

### `css_variables` — CSS custom properties (design tokens) (`STRICT`)

| Column      | Type       | Description                                   |
| ----------- | ---------- | --------------------------------------------- |
| id          | INTEGER PK | Auto-increment row id                         |
| file_path   | TEXT FK    | CSS file containing the variable              |
| name        | TEXT       | Variable name (e.g. `--blue-50`)              |
| value       | TEXT       | Parsed value (e.g. `rgb(215, 225, 242)`)      |
| scope       | TEXT       | Where defined: `:root`, `@theme`, or selector |
| line_number | INTEGER    | Line number (1-based)                         |

### `css_classes` — CSS class definitions (`STRICT`)

| Column      | Type       | Description                     |
| ----------- | ---------- | ------------------------------- |
| id          | INTEGER PK | Auto-increment row id           |
| file_path   | TEXT FK    | CSS file containing the class   |
| name        | TEXT       | Class name (without `.` prefix) |
| is_module   | INTEGER    | 1 if from a `.module.css` file  |
| line_number | INTEGER    | Line number (1-based)           |

### `css_keyframes` — `@keyframes` animation definitions (`STRICT`)

| Column      | Type       | Description                       |
| ----------- | ---------- | --------------------------------- |
| id          | INTEGER PK | Auto-increment row id             |
| file_path   | TEXT FK    | CSS file containing the keyframes |
| name        | TEXT       | Animation name                    |
| line_number | INTEGER    | Line number (1-based)             |

### `markers` — TODO/FIXME/HACK/NOTE comments (extracted from all file types) (`STRICT`)

| Column      | Type       | Description                        |
| ----------- | ---------- | ---------------------------------- |
| id          | INTEGER PK | Auto-increment row id              |
| file_path   | TEXT FK    | File with the marker               |
| line_number | INTEGER    | Line number                        |
| kind        | TEXT       | `TODO`, `FIXME`, `HACK`, or `NOTE` |
| content     | TEXT       | Comment text                       |

### `meta` — Key-value metadata (`STRICT, WITHOUT ROWID`)

| Column | Type    | Description                                                |
| ------ | ------- | ---------------------------------------------------------- |
| key    | TEXT PK | e.g. `schema_version`, `last_indexed_commit`, `indexed_at` |
| value  | TEXT    | Stored value                                               |

### Indexes

All tables have covering indexes tuned for AI agent query patterns. See [Covering indexes](#covering-indexes) and [Partial indexes](#partial-indexes) for the full list.

## Parsers

### TypeScript/TSX — `parser.ts` (`oxc-parser`)

Uses the Rust-based `oxc-parser` via NAPI bindings to parse TypeScript/TSX/JS/JSX files into an AST. Extracts:

- **Symbols**: Functions, arrow functions, classes, interfaces, type aliases, enums — with reconstructed signatures
- **Imports**: All `import` statements with specifiers, source paths, and type-only flags
- **Exports**: Named exports, default exports, re-exports
- **Components**: React components detected via PascalCase name + JSX return. Extracts props type and hooks used
- **Markers**: `TODO`, `FIXME`, `HACK`, `NOTE` comments with line numbers

### CSS — `css-parser.ts` (`lightningcss`)

Uses the Rust-based `lightningcss` via NAPI bindings with a visitor pattern to traverse the CSS AST. Extracts:

- **Custom properties**: `--variable-name: value` declarations, including scope (`:root`, `@theme`, or selector)
- **Tailwind v4 `@theme` blocks**: Registered as a custom at-rule (`customAtRules: { theme: { body: "declaration-list" } }`) so variables inside `@theme { }` are captured with scope `@theme`
- **Class names**: Extracted from selectors via `extractClassNames`. Flags `.module.css` files
- **Keyframes**: `@keyframes` animation names
- **Imports**: `@import` source paths
- **Markers**: Same `TODO`/`FIXME` extraction as other file types

Falls back to regex extraction if `lightningcss` parsing fails.

**Sass / Less / SCSS (not supported yet):** those languages are not parsed by Lightning CSS. A future option is an **opt-in** pipeline (compile to CSS, then index like `.css`) or a dedicated adapter; tracked in [roadmap.md § Backlog](./roadmap.md#backlog).

### Import resolution — `resolver.ts` (`oxc-resolver`)

Uses the Rust-based `oxc-resolver` to resolve import specifiers to absolute file paths. Configured with:

- `tsconfig.configFile` pointing to `tsconfig.json` (resolves `~/` path aliases)
- `extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"]`
- `mainFields: ["module", "main"]`

Only resolves to files within the indexed set (skips `node_modules` dependencies). Produces the `dependencies` table entries.

### Generic text files

Files without a specialized parser (`.md`, `.mdc`, `.mdx`, `.json`, `.yaml`, `.sh`, `.txt`) get:

- Basic `files` table entry (path, size, line count, language, hash)
- Marker extraction (`TODO`/`FIXME`/`HACK`/`NOTE`) via regex

## Incremental Updates

The indexer uses git to detect changes since the last indexed commit:

1. **Stores `last_indexed_commit`** (HEAD SHA) in the `meta` table after each run
2. On next run, computes `git diff --name-only <last_commit>..HEAD` + `git status --porcelain`
3. Only re-indexes changed files (Wyhash content comparison), using DB-sourced `indexedPaths` for import resolution (skips full `collectFiles()` glob scan)
4. Deleted files are removed via `ON DELETE CASCADE` — deleting from `files` cascades to all related tables
5. Falls back to full rebuild if commit history is incompatible (e.g. force push, branch switch)

## File Artifacts

Running the indexer produces up to three files in the project root, all gitignored:

### `.codemap.db`

The main SQLite database file. Contains all tables and indexes. This is the persistent data store that survives between runs. Typically 2-5 MB for this project.

### `.codemap.db-wal` (Write-Ahead Log)

Created automatically because the database uses `PRAGMA journal_mode = WAL`. Instead of writing changes directly to the main `.db` file, SQLite appends them to this WAL file first. This enables:

- **Concurrent readers during writes** — readers see a consistent snapshot while the indexer writes
- **Crash safety** — if the process dies mid-write, the WAL is replayed on next open
- **Better write performance** — sequential appends to WAL are faster than random writes to the B-tree

The WAL gets **checkpointed** (merged back into `.codemap.db`) periodically by SQLite or when the last connection closes cleanly. After a clean close, this file may be empty (0 bytes) or absent.

### `.codemap.db-shm` (Shared Memory)

A memory-mapped index into the WAL file. Allows multiple processes to coordinate concurrent read access to the WAL without locking the main database file. Contains a hash table mapping page numbers to WAL frame locations.

This file is **always present when the WAL file exists** and is cleaned up when the last connection closes. It's typically small (32 KB).

### Why these files exist

All three are consequences of WAL mode (`PRAGMA journal_mode = WAL` in `db.ts`). WAL mode is chosen over the default rollback journal because:

1. Readers never block writers and writers never block readers
2. Better performance for the write-heavy indexing workload (bulk inserts in a transaction)
3. `PRAGMA synchronous = NORMAL` is safe with WAL (vs `FULL` required with rollback journal)

**You can safely ignore `-wal` and `-shm` files.** They are transient SQLite plumbing, not your data. Never delete them while the database is open — SQLite needs them for consistency. They are cleaned up automatically on clean connection close.

## Full Rebuild Optimizations

The full rebuild (`--full`) applies several optimizations that are not safe for incremental updates but dramatically speed up cold builds:

### Worker thread parallelism

File I/O and parsing dominate full rebuild time. The indexer spawns N worker threads (capped at CPU count, min 2, max 6) via `parse-worker.ts`. Each worker receives a chunk of file paths, reads files from disk, and runs the appropriate parser (oxc-parser, lightningcss, or regex). Workers return structured `ParsedFile` results to the main thread, which handles import resolution and database inserts serially.

### Deferred index creation

During full rebuild, `createTables(db)` runs DDL without indexes. All data is inserted into unindexed tables, then `createIndexes(db)` builds all B-trees in a single sorted pass. This avoids the overhead of updating indexes on every INSERT — bulk index creation is O(N log N) once vs O(N × log N) incrementally.

### PRAGMA tuning during rebuild

Two PRAGMAs are temporarily relaxed for the rebuild transaction:

| PRAGMA         | Rebuild value | Normal value | Why                                                          |
| -------------- | ------------- | ------------ | ------------------------------------------------------------ |
| `synchronous`  | `OFF`         | `NORMAL`     | Skips fsync entirely — safe because a crash just means rerun |
| `foreign_keys` | `OFF`         | `ON`         | Skips FK constraint checks on every INSERT                   |

Both are restored to normal values after the rebuild completes.

### Generic `batchInsert` helper

All bulk insert functions use a shared `batchInsert<T>()` helper that:

- **Pre-computes placeholder strings** — `Array(BATCH_SIZE).fill(one).join(",")` is computed once per call, reused for all full batches; only the tail batch generates a dynamic placeholder
- **Eliminates `.slice()` allocations** — iterates with index bounds (`i` to `end`) instead of copying array segments per batch
- **Uses indexed `for (let j)` loops** — avoids per-batch iterator protocol overhead

Batches of 100 rows per `INSERT ... VALUES (...),(...),(...)` statement reduce per-statement overhead (parse, plan, execute cycle) by ~100×.

### Sorted inserts

Parsed results are sorted by file path before insertion. This improves B-tree page locality — sequential keys land on the same pages, reducing page splits and improving cache hit rates during the subsequent index creation pass.

### Skip per-file deletes

During full rebuild the tables are empty (just created), so the per-file `deleteFileData()` call is skipped entirely — no `DELETE` per file before insert.

## Supported File Types

| Extension(s)                  | Language | Parser         | What's extracted                                     |
| ----------------------------- | -------- | -------------- | ---------------------------------------------------- |
| `.ts`, `.tsx`, `.mts`, `.cts` | ts/tsx   | `oxc-parser`   | Symbols, imports, exports, components, deps, markers |
| `.js`, `.jsx`, `.mjs`, `.cjs` | js/jsx   | `oxc-parser`   | Same as TS (parser handles JS fine)                  |
| `.css`                        | css      | `lightningcss` | Variables, classes, keyframes, imports, markers      |
| `.md`                         | md       | regex          | Markers only                                         |
| `.mdx`                        | mdx      | regex          | Markers only                                         |
| `.mdc`                        | mdc      | regex          | Markers only                                         |
| `.json`                       | json     | regex          | Markers only                                         |
| `.yml`, `.yaml`               | yaml     | regex          | Markers only                                         |
| `.sh`                         | sh       | regex          | Markers only                                         |
| `.txt`                        | txt      | regex          | Markers only                                         |

## Schema Versioning

The `meta` table stores `schema_version`. The canonical version is `SCHEMA_VERSION` in `db.ts` (exported). Both `createSchema()` and the full-rebuild path in `index.ts` persist `String(SCHEMA_VERSION)` after building tables and indexes.

When `SCHEMA_VERSION` is bumped (after the first release, when DDL changes require it):

- `createSchema()` detects the mismatch automatically and calls `dropAll()` before recreating
- No manual intervention needed — run the indexer and it auto-rebuilds on version change

Until the first release, Codemap keeps **`SCHEMA_VERSION` at 2**; pull `--full` or delete `.codemap.db` when the DDL in `db.ts` changes without a version bump.

## SQLite Performance Configuration

### `bun:sqlite` API

All DDL and PRAGMA statements use `Database.run()` (not the deprecated `Database.exec()` alias). Parameterized insert/update statements use `Database.query()` (which caches compiled statements) instead of `Database.prepare()` (which does not cache). Read queries also use `Database.query().all()` or `.get()`. Bulk inserts use the generic `batchInsert<T>()` helper with multi-row `INSERT ... VALUES (...),(...),(...)` in batches of 100, pre-computed placeholders, and zero-copy index-bounds iteration.

### PRAGMAs (set on every `openDb()`)

| PRAGMA                | Value       | Why                                                                      |
| --------------------- | ----------- | ------------------------------------------------------------------------ |
| `journal_mode`        | `WAL`       | Concurrent reads during writes, crash safety, faster bulk inserts        |
| `synchronous`         | `NORMAL`    | Safe with WAL, avoids costly fsync on every transaction                  |
| `foreign_keys`        | `ON`        | Enforces `ON DELETE CASCADE` for data integrity                          |
| `case_sensitive_like` | `ON`        | Lets LIKE prefix queries use B-tree indexes (paths are case-sensitive)   |
| `temp_store`          | `MEMORY`    | Keeps temp B-trees (DISTINCT, ORDER BY) in RAM instead of disk           |
| `mmap_size`           | `268435456` | 256 MB memory-mapped I/O — fewer copies vs reading through the VFS alone |
| `cache_size`          | `-16384`    | 16 MB page cache (default ~2 MB), keeps working set in memory            |

### On close (`closeDb()`)

| PRAGMA           | Value | Why                                                                |
| ---------------- | ----- | ------------------------------------------------------------------ |
| `analysis_limit` | `400` | Caps rows sampled by `optimize` to keep it fast                    |
| `optimize`       | —     | Gathers query planner statistics (`sqlite_stat1`) for better plans |

### WITHOUT ROWID tables

Tables with a TEXT PRIMARY KEY and no auto-increment benefit from `WITHOUT ROWID` — the data is stored directly in the primary key B-tree instead of a separate rowid B-tree, eliminating a lookup indirection:

- `dependencies` (composite PK: `from_path, to_path`)
- `meta` (PK: `key`)

### STRICT tables

All tables use `STRICT` mode, which enforces column types at insert time — an INTEGER column rejects TEXT values and vice versa. Catches data corruption bugs immediately rather than silently coercing types. Combined with `WITHOUT ROWID` on applicable tables: `STRICT, WITHOUT ROWID`.

### Partial indexes

Subset indexes for the most common AI agent query patterns — smaller B-trees that only index rows matching a WHERE filter:

| Index                   | Filter                  | Purpose                                    |
| ----------------------- | ----------------------- | ------------------------------------------ |
| `idx_symbols_exported`  | `WHERE is_exported=1`   | "What does this module export?" queries    |
| `idx_symbols_functions` | `WHERE kind='function'` | "Find function X" — the most common lookup |

### Covering indexes

A covering index includes all columns needed by a query, so SQLite never touches the main table — it reads everything from the index B-tree alone. The query plan shows `USING COVERING INDEX` instead of a table lookup.

Key covering indexes:

| Index                    | Columns                                                               | Covers                     |
| ------------------------ | --------------------------------------------------------------------- | -------------------------- |
| `idx_symbols_name`       | `name, kind, file_path, line_start, line_end, signature, is_exported` | Symbol lookup by name      |
| `idx_imports_source`     | `source, file_path`                                                   | "Who imports X?" queries   |
| `idx_imports_resolved`   | `resolved_path, file_path`                                            | Resolved path lookups      |
| `idx_exports_name`       | `name, file_path, kind, is_default`                                   | Export lookup by name      |
| `idx_components_name`    | `name, file_path, props_type, hooks_used`                             | Component search by name   |
| `idx_components_file`    | `file_path, name`                                                     | Components in a directory  |
| `idx_dependencies_to`    | `to_path, from_path`                                                  | Reverse dependency lookups |
| `idx_markers_kind`       | `kind, file_path, line_number, content`                               | Marker listing by kind     |
| `idx_css_variables_name` | `name, value, scope, file_path`                                       | CSS token lookup by name   |
| `idx_css_classes_name`   | `name, file_path, is_module`                                          | CSS class lookup           |
| `idx_css_keyframes_name` | `name, file_path`                                                     | Keyframe lookup            |
