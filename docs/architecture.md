# Codemap — Architecture

See [documentation index](./README.md).

## Overview

A local SQLite database (`.codemap.db`) indexes the project tree and stores structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers) for SQL queries instead of repeated full-tree scans.

### Runtime and database

**`src/sqlite-db.ts`:** Node uses **`better-sqlite3`**; Bun uses **`bun:sqlite`**. Same schema everywhere. **`better-sqlite3`** allows **one SQL statement per `prepare()`**; **`bun:sqlite`** accepts **multiple statements** in one `run()`. On Node, **`runSql()`** splits multi-statement strings on **`;`** and runs each fragment. Do **not** put **`;`** inside **`--` line comments** in **`db.ts`** DDL strings (naive split would break). Details: [packaging.md § Node vs Bun](./packaging.md#node-vs-bun).

**`src/worker-pool.ts`:** Bun `Worker` or Node `worker_threads`. **`src/glob-sync.ts`:** Bun **`Glob`** or **`tinyglobby`** for include patterns. **`src/config.ts`:** loads **`codemap.config.json`** / **`codemap.config.ts`** (JSON read path: **`Bun.file`** on Bun, **`readFile` + `JSON.parse`** on Node — [packaging.md § Node vs Bun](./packaging.md#node-vs-bun)), then validates with **Zod** (`codemapUserConfigSchema`). Details: [User config](#user-config).

**Shipped artifact:** **`dist/`** — `package.json` **`bin`** and **`exports`** both point at **`dist/index.mjs`** ([packaging.md](./packaging.md)); tsdown also emits **lazy CLI chunks** (`cmd-index`, `cmd-query`, `cmd-agents`, …) loaded via **`import()`** from **`src/cli/main.ts`**.

## Layering

| Layer                                        | Role                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`cli/`** (`bootstrap`, `main`, `cmd-*`)    | Parses argv; **dynamic `import()`** loads only the command chunk (`cmd-index`, `cmd-query`, `cmd-agents`) so `--help` / `version` / `agents init` avoid the indexer. |
| **`api.ts`**                                 | Public programmatic surface: `createCodemap()`, `Codemap` (`query`, `index`), re-exports `runCodemapIndex` for advanced use.                                         |
| **`application/`**                           | Use cases: `run-index.ts` (incremental / full / targeted orchestration), `index-engine.ts` (collect files, git diff, `indexFiles`, workers via `worker-pool.ts`).    |
| **`adapters/`**                              | `LanguageAdapter` registry; built-ins call `parser.ts` / `css-parser.ts` / `markers.ts` from `parse-worker-core`.                                                    |
| **`runtime.ts` / `config.ts` / `db.ts` / …** | Config, SQLite, resolver, workers.                                                                                                                                   |

`index.ts` is the package entry: re-exports the public API and runs `cli/main` only when executed as the main module (Node/Bun `codemap` binary).

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

| File                                                                                              | Purpose                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                                                        | Package entry — re-exports `api` / `config`, runs CLI when main                                                                                                       |
| `cli/`                                                                                            | CLI — bootstrap argv, lazy command modules, `query` / `validate` / `context` / `agents init` / index modes                                                            |
| `api.ts`                                                                                          | Programmatic API — `createCodemap`, `Codemap`, `runCodemapIndex`                                                                                                      |
| `application/`                                                                                    | Indexing use cases and engine (`run-index`, `index-engine`, types)                                                                                                    |
| `worker-pool.ts`                                                                                  | Parallel parse workers (Bun / Node)                                                                                                                                   |
| `db.ts`                                                                                           | SQLite adapter — schema DDL, typed CRUD, connection management                                                                                                        |
| `parser.ts`                                                                                       | TS/TSX/JS/JSX extraction via `oxc-parser` — symbols (with JSDoc + generics + return types), type members, imports, exports, components, markers                       |
| `css-parser.ts`                                                                                   | CSS extraction via `lightningcss` — custom properties, classes, keyframes, `@theme` blocks                                                                            |
| `resolver.ts`                                                                                     | Import path resolution via `oxc-resolver` — respects `tsconfig` aliases, builds dependency graph                                                                      |
| `constants.ts`                                                                                    | Shared constants — e.g. `LANG_MAP`                                                                                                                                    |
| `glob-sync.ts`                                                                                    | Include globs — Bun `Glob` vs `tinyglobby` on Node ([packaging § Node vs Bun](./packaging.md#node-vs-bun))                                                            |
| `markers.ts`                                                                                      | Shared marker extraction (`TODO`/`FIXME`/`HACK`/`NOTE`) — used by all parsers                                                                                         |
| `parse-worker.ts`                                                                                 | Worker thread entry point — reads, parses, and extracts file data in parallel                                                                                         |
| `adapters/`                                                                                       | `LanguageAdapter` types and built-in TS/CSS/text implementations                                                                                                      |
| `parsed-types.ts`                                                                                 | Shared `ParsedFile` shape for workers and adapters                                                                                                                    |
| `agents-init.ts` / `agents-init-interactive.ts`                                                   | `codemap agents init` — see [agents.md](./agents.md) (granular template + IDE writes, pointer upsert, **`--interactive`**, `.gitignore`)                              |
| `benchmark.ts` (+ `benchmark-default-scenarios.ts`, `benchmark-config.ts`, `benchmark-common.ts`) | SQL vs traditional timing; optional **`CODEMAP_BENCHMARK_CONFIG`** JSON — [benchmark.md § Custom scenarios](./benchmark.md#custom-scenarios-codemap_benchmark_config) |
| `config.ts`                                                                                       | `codemap.config.*` load path, **Zod** user schema (`codemapUserConfigSchema`), `resolveCodemapConfig`                                                                 |

## CLI usage

**Commands and flags** (index, query, **`codemap agents init`**, **`--root`**, **`--config`**, environment): [../README.md § CLI](../README.md#cli) — **do not duplicate** flag lists here; this section only adds implementation notes. From this repository: **`bun run dev`** or **`bun src/index.ts`** (same flags).

**Query wiring:** **`src/cli/cmd-query.ts`** (argv, **`printQueryResult`**, `--recipe` / `-r` alias, **`--summary`**, **`--changed-since`**, **`--group-by`**, **`--save-baseline`** / **`--baseline`** / **`--baselines`** / **`--drop-baseline`**), **`src/cli/query-recipes.ts`** (**`QUERY_RECIPES`** — bundled SQL only source; optional **`actions: RecipeAction[]`** per recipe), **`src/cli/main.ts`** (**`--recipes-json`** / **`--print-sql`** exit before config/DB). With **`--json`**, errors use **`{"error":"…"}`** on stdout for SQL failures, DB open, and bootstrap (same shape); **`runQueryCmd`** sets **`process.exitCode`** instead of **`process.exit`**. Friendlier "no `.codemap.db`" — `no such table: <X>` and `no such column: <X>` errors are rewritten in **`enrichQueryError`** to point at `codemap` / `codemap --full`. **`--summary`** filters output only — the SQL still executes against the index; output collapses to `{"count": N}` (with `--json`) or `count: N`. **`--changed-since <ref>`** post-filters result rows by `path` / `file_path` / `from_path` / `to_path` / `resolved_path` against `git diff --name-only <ref>...HEAD ∪ git status --porcelain` (helper: **`src/git-changed.ts`** — `getFilesChangedSince`, `filterRowsByChangedFiles`, `PATH_COLUMNS`); rows with no recognised path column pass through. **`--group-by <mode>`** (`owner` | `directory` | `package`) routes through **`runGroupedQuery`** in `cmd-query.ts` and emits `{"group_by": "<mode>", "groups": [{key, count, rows}]}` (or `[{key, count}]` with `--summary`); helpers in **`src/group-by.ts`** (`groupRowsBy`, `firstDirectory`, `loadCodeowners`, `discoverWorkspaceRoots`, `makePackageBucketizer`, `codeownersGlobToRegex`). CODEOWNERS lookup is last-match-wins (GitHub semantics); workspace discovery reads `package.json` `workspaces` and `pnpm-workspace.yaml` `packages:`. **`--save-baseline[=<name>]`** snapshots the result to the **`query_baselines`** table inside `.codemap.db` (no parallel JSON files; survives `--full` / SCHEMA bumps because the table is intentionally absent from `dropAll()`); name defaults to `--recipe` id, ad-hoc SQL needs an explicit name. **`--baseline[=<name>]`** replays the SQL, fetches the saved row set, and emits `{baseline:{...}, current_row_count, added: [...], removed: [...]}` (or `{baseline:{...}, current_row_count, added: N, removed: N}` with `--summary`); identity is per-row multiset equality (canonical `JSON.stringify` keyed frequency map — duplicate rows are tracked, not collapsed). No fuzzy "changed" category in v1. **`--group-by` is mutually exclusive** with both `--save-baseline` and `--baseline` (different output shapes). **`--baselines`** (read-only list) and **`--drop-baseline <name>`** complete the surface; helpers in **`src/db.ts`** (`upsertQueryBaseline`, `getQueryBaseline`, `listQueryBaselines`, `deleteQueryBaseline`). **Per-row recipe `actions`** are appended only when the user runs **`--recipe <id>`** with **`--json`** AND the recipe defines an `actions` template — programmatic `cm.query(sql)` and ad-hoc CLI SQL never carry actions; under `--baseline`, actions attach to `added` rows only (the rows the agent should act on). The **`components-by-hooks`** recipe ranks by hook count with a **comma-based tally** on **`hooks_used`** (no SQLite JSON1). Shipped **`templates/agents/`** documents **`codemap query --json`** as the primary agent example ([README § CLI](../README.md#cli)).

**Validate wiring:** **`src/cli/cmd-validate.ts`** — **`computeValidateRows`** is a pure function over `(db, projectRoot, paths)` returning `{path, status}` rows where `status ∈ stale | missing | unindexed`. CLI wraps it with read-once-and-print + exits **1** on any drift (git-status semantics). Path normalization: **`toProjectRelative`** converts CLI input to POSIX-style relative keys matching the `files.path` storage format (Windows backslash → forward slash); same convention as `lint-staged.config.js`.

**Audit wiring:** **`src/cli/cmd-audit.ts`** (argv, `--baseline <prefix>` auto-resolve sugar, `--<key>-baseline <name>` per-delta explicit overrides, `--json`, `--summary`, `--no-index`) + **`src/application/audit-engine.ts`** (delta registry + diff). Mirrors the `cmd-index.ts ↔ application/index-engine.ts` seam — CLI parses + dispatches; engine does the diff. **`runAudit({db, baselines})`** iterates the per-delta baseline map; deltas absent from the map don't run. Each entry in **`V1_DELTAS`** pins a canonical SQL projection (`files`: `SELECT path FROM files`; `dependencies`: `SELECT from_path, to_path FROM dependencies`; `deprecated`: `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%'`) plus a `requiredColumns` list. **`computeDelta`** validates baseline column-set membership, projects baseline rows down to the canonical column subset (extras dropped — schema-drift-resilient), runs the canonical SQL via the caller's DB connection, and set-diffs via the existing **`src/diff-rows.ts`** multiset helper (shared with `query --baseline`). Each emitted delta carries its own **`base`** metadata so mixed-baseline audits (e.g. `--baseline base --dependencies-baseline override`) are first-class. **`runAuditCmd`** runs an auto-incremental-index prelude (`runCodemapIndex({mode: "incremental", quiet: true})`) before the diff so `head` reflects the current source — `--no-index` opts out for frozen-DB CI scenarios. **`resolveAuditBaselines({db, baselinePrefix, perDelta})`** composes the baseline map: auto-resolves `<prefix>-<delta-key>` for slots that exist (silently absent otherwise) and lets per-delta flags override individual slots. v1 ships no `verdict` / threshold config / non-zero exit codes — consumers compose `--json` + `jq` for CI exit codes; v1.x adds `verdict` + `codemap.config.audit` thresholds + `--base <ref>` (worktree+reindex snapshot strategy).

**Context wiring:** **`src/cli/cmd-context.ts`** — **`buildContextEnvelope`** composes the JSON envelope from existing recipes (`fan-in` for `hubs`, `markers` SELECT for `sample_markers`, `QUERY_RECIPES` map for the catalog). **`classifyIntent`** maps `--for "<text>"` to one of `refactor | debug | test | feature | explore | other` via regex against the trimmed input; whitespace-only intents are rejected. `--compact` drops `hubs` + `sample_markers` and emits one-line JSON; otherwise pretty-prints with 2-space indent.

**MCP wiring:** **`src/cli/cmd-mcp.ts`** (argv — `--help` only; bootstrap absorbs `--root`/`--config`) + **`src/application/mcp-server.ts`** (engine — tool registry, resource handlers, response composition). Mirrors the `cmd-audit.ts ↔ audit-engine.ts` seam — CLI parses + lifecycle; engine owns the SDK. **`runMcpServer`** bootstraps codemap once at server boot (config + resolver + DB access become module-level state), instantiates `McpServer` from **`@modelcontextprotocol/sdk`**, attaches a **`StdioServerTransport`**, and resolves when stdin closes (clean shutdown). Tool handlers reuse the existing engine entry-points: **`query`** + **`query_recipe`** call **`executeQuery`** in **`src/application/query-engine.ts`** (a pure transport-agnostic engine extracted from `printQueryResult`'s JSON branch — same `[...rows]` / `{count}` / `{group_by, groups}` envelope `--json` would print); **`query_batch`** loops via **`executeQueryBatch`** with batch-wide-defaults + per-statement-overrides (items are `string | {sql, summary?, changed_since?, group_by?}`); **`audit`** runs `resolveAuditBaselines` + `runAudit` from PR #33 unchanged; **`context`** / **`validate`** call `buildContextEnvelope` / `computeValidateRows` (pure functions in `src/cli/cmd-*.ts` — same layer-reversal allowance as `query-recipes`). **`save_baseline`** is one polymorphic tool (`{name, sql? | recipe?}`) with a runtime exclusivity check — mirrors the CLI's single `--save-baseline=<name>` verb. **Tool naming**: snake_case throughout — Codemap convention matching the patterns in MCP spec examples and reference servers (GitHub MCP, Cursor built-ins); the spec itself doesn't mandate it. CLI stays kebab — translation lives at the MCP-arg layer. **Resources** (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`) use **lazy memoisation** — first `read_resource` populates a per-server-instance cache; constant for the server-process lifetime so eager-vs-lazy produce identical observable behavior. `codemap://schema` queries `sqlite_schema` live; `codemap://skill` reads from `resolveAgentsTemplateDir() + skills/codemap/SKILL.md`. Output shape uniformity (plan § 4): every tool returns the JSON envelope its CLI counterpart's `--json` flag prints, surfaced via `content: [{type: "text", text: JSON.stringify(payload)}]`. `--changed-since` git lookups are memoised per `(root, ref)` pair across batch items so a `query_batch` of N items sharing the same ref does one git invocation, not N. Per-statement errors in `query_batch` are isolated — failed statements return `{error}` in their slot while siblings still execute.

**Performance wiring:** **`--performance`** plumbs through **`RunIndexOptions.performance`** → **`indexFiles({ performance, collectMs })`**. `parse-worker-core.ts` records per-file **`parseMs`** on each `ParsedFile`; main thread times the four phases (`collect`, `parse`, `insert`, `index_create`) and assembles **`IndexPerformanceReport`** under `IndexRunStats.performance`. Note: `total_ms` is `indexFiles` wall-clock, **not** end-to-end run wall — `collect_ms` happens before `indexFiles` and is reported separately.

**Agent templates:** `codemap agents init` — full matrix [agents.md](./agents.md).

**Timings and methodology:** [benchmark.md](./benchmark.md). **Startup / Node vs Bun** (not the same as benchmark scenarios): [benchmark.md § CLI and runtime startup](./benchmark.md#cli-and-runtime-startup).

### Help, version, and invalid argv

**`--help`** / **`-h`**, **`version`** / **`--version`** / **`-V`** are handled in **`src/cli/bootstrap.ts`** / **`src/cli/main.ts`** before config or DB access. Unknown **`--…`** flags and stray tokens for the default index mode are rejected with an error (see **`validateIndexModeArgs`**) instead of falling through to indexing.

### `--files` (targeted reindex)

When specific file paths are passed via `--files`, the indexer skips git diff, git status, and the full filesystem glob scan. It reads the set of already-indexed paths from the database (for import resolution), then only processes the listed files. Files with non-standard extensions (e.g. custom `include` globs) are accepted and indexed as text; a warning is printed but they are not skipped. Files that no longer exist on disk are automatically removed from the index via `ON DELETE CASCADE`.

## Programmatic usage

The npm package exports **`createCodemap`**, **`Codemap`** (`query`, `index`), **`runCodemapIndex`** (advanced), **`codemapUserConfigSchema`**, **`parseCodemapUserConfig`**, **`defineConfig`**, **`CodemapDatabase`** (type), adapter types (`LanguageAdapter`, `getAdapterForExtension`, …), and **`ParsedFile`** — see **`src/api.ts`** / **`src/index.ts`** and **`dist/index.d.mts`**. Typical flow:

1. **`await createCodemap({ root, configFile?, config? })`** — loads `codemap.config.*`, calls **`initCodemap`** and **`configureResolver`**.
2. **`await cm.index({ mode, files?, quiet? })`** — same pipeline as the CLI (incremental / full / targeted).
3. **`cm.query(sql)`** — read-only SQL against `.codemap.db` (opens the DB per call).

**Constraint:** `initCodemap` is global to the process; only one active indexed project at a time.

### User config

Optional **`codemap.config.ts`** (default export: object or async factory) or **`codemap.config.json`** at the project root; **`--config`** points at either. Example shape: [`codemap.config.example.json`](../codemap.config.example.json).

**Validation:** **`codemapUserConfigSchema`** ([Zod](https://zod.dev)) — strict object (unknown keys are rejected). **`defineConfig({ ... })`**, **`parseCodemapUserConfig`**, and **`resolveCodemapConfig`** (CLI and merged `createCodemap({ config })`) all go through the same schema. Invalid config throws **`TypeError`** with a short path/message list.

**Exports:** `codemapUserConfigSchema`, `parseCodemapUserConfig`, `defineConfig`, and **`CodemapUserConfig`** (inferred type) from the package entry — see **`src/config.ts`** / **`dist/index.d.mts`**.

## Schema

**Fingerprints:** incremental runs compare **`files.content_hash`** — SHA-256 hex of raw file bytes from [`src/hash.ts`](../src/hash.ts) (same on Node and Bun). Details in the **`files`** table below.

**Fresh database:** the default CLI **`codemap`** (incremental) calls **`createSchema()`** in **`runCodemapIndex`** before **`getChangedFiles()`**, so the **`meta`** table exists before **`getMeta(..., "last_indexed_commit")`** runs on an empty **`.codemap.db`**.

Current schema version: **5** — see [Schema Versioning](#schema-versioning) for details.

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

### `symbols` — Functions, constants, classes, interfaces, types, enums (`STRICT`)

| Column            | Type       | Description                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                | INTEGER PK | Auto-increment row id                                                                                                                                                                                                                                                                                                                                              |
| file_path         | TEXT FK    | References `files(path)` ON DELETE CASCADE                                                                                                                                                                                                                                                                                                                         |
| name              | TEXT       | Symbol name                                                                                                                                                                                                                                                                                                                                                        |
| kind              | TEXT       | `function`, `const`, `class`, `interface`, `type`, `enum`, `method`, `property`, `getter`, `setter` (last four are class members)                                                                                                                                                                                                                                  |
| line_start        | INTEGER    | Start line (1-based)                                                                                                                                                                                                                                                                                                                                               |
| line_end          | INTEGER    | End line                                                                                                                                                                                                                                                                                                                                                           |
| signature         | TEXT       | Reconstructed signature with generics and return types (e.g. `identity<T>(val): T`, `interface Repo<T> extends Iterable<T>`, `class Store<T> extends Base<T> implements IStore<T>`)                                                                                                                                                                                |
| is_exported       | INTEGER    | 1 if exported                                                                                                                                                                                                                                                                                                                                                      |
| is_default_export | INTEGER    | 1 if default export                                                                                                                                                                                                                                                                                                                                                |
| members           | TEXT       | JSON array of enum members (NULL for non-enums). Each entry: `{"name":"…","value":"…"}` (value omitted for implicit-value enums)                                                                                                                                                                                                                                   |
| doc_comment       | TEXT       | Leading JSDoc comment text (cleaned: `*` prefixes stripped, trimmed). NULL when absent. Preserves `@deprecated`, `@param`, etc. tags                                                                                                                                                                                                                               |
| value             | TEXT       | Literal value for `const` declarations (strings, numbers, booleans, `null`). NULL for non-literal or non-const symbols. Handles `as const` and simple template literals                                                                                                                                                                                            |
| parent_name       | TEXT       | Name of the enclosing symbol (class, function) for nested symbols. NULL for top-level (module scope). Class methods/properties point to their class                                                                                                                                                                                                                |
| visibility        | TEXT       | JSDoc visibility tag derived from `doc_comment` at parse time: `public` / `private` / `internal` / `alpha` / `beta`. NULL when no tag present. Tag must start its own line (after the JSDoc `*` prefix); first match in document order wins. Powers the `visibility-tags` recipe and `WHERE visibility = ?` queries via the partial index `idx_symbols_visibility` |

### `calls` — Function-scoped call edges, deduped per file (`STRICT`)

| Column       | Type       | Description                                                                        |
| ------------ | ---------- | ---------------------------------------------------------------------------------- |
| id           | INTEGER PK | Auto-increment row id                                                              |
| file_path    | TEXT FK    | References `files(path)` ON DELETE CASCADE                                         |
| caller_name  | TEXT       | Name of the calling function/method                                                |
| caller_scope | TEXT       | Dot-joined scope path (e.g. `UserService.run`). Disambiguates same-named methods   |
| callee_name  | TEXT       | Name of the called function, `obj.method` for member calls, `this.method` for self |

Edges are deduped per (caller_scope, callee) per file: if `foo` calls `bar` three times in the same file, only one row is stored. Same-named methods in different classes get distinct `caller_scope` values. Module-level calls (outside any function) are excluded — only function-scoped calls are tracked.

### `type_members` — Properties and methods of interfaces and object-literal types (`STRICT`)

| Column      | Type       | Description                                               |
| ----------- | ---------- | --------------------------------------------------------- |
| id          | INTEGER PK | Auto-increment row id                                     |
| file_path   | TEXT FK    | References `files(path)` ON DELETE CASCADE                |
| symbol_name | TEXT       | Name of the parent interface or type alias                |
| name        | TEXT       | Property or method name                                   |
| type        | TEXT       | Type annotation string (e.g. `string`, `(key) => number`) |
| is_optional | INTEGER    | 1 if `?` modifier present                                 |
| is_readonly | INTEGER    | 1 if `readonly` modifier present                          |

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
| kind             | TEXT       | `value`, `type`, `re-export` |
| is_default       | INTEGER    | 1 if default export          |
| re_export_source | TEXT       | Source module if re-exported |

### `components` — React components (detected by PascalCase + JSX return or hook usage) (`STRICT`)

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

### `query_baselines` — Saved query result snapshots (user data) (`STRICT`)

User-facing baselines saved by `codemap query --save-baseline`, replayed by `codemap query --baseline` for diffs (added / removed rows). Lives next to the index tables so the entire codemap state stays in one SQLite file — no parallel JSON snapshot files. **Intentionally absent from `dropAll()`** so `--full` and `SCHEMA_VERSION` rebuilds preserve baselines (only index tables get dropped).

| Column     | Type    | Description                                                                               |
| ---------- | ------- | ----------------------------------------------------------------------------------------- |
| name       | TEXT PK | User-supplied name; defaults to the `--recipe` id (ad-hoc SQL must pass an explicit name) |
| recipe_id  | TEXT    | The `--recipe` id when known; NULL for ad-hoc SQL                                         |
| sql        | TEXT    | The SQL that produced the snapshot (replayable; useful when re-running on a new branch)   |
| rows_json  | TEXT    | Canonical `JSON.stringify(rows)`. Diff identity is per-row JSON-stringify equality        |
| row_count  | INTEGER | Cached length of `rows_json` for fast `--baselines` listing                               |
| git_ref    | TEXT    | `git rev-parse HEAD` at save time, or NULL when not a git working tree                    |
| created_at | INTEGER | `Date.now()` at save time (epoch ms)                                                      |

### Indexes

All tables have covering indexes tuned for AI agent query patterns. See [Covering indexes](#covering-indexes) and [Partial indexes](#partial-indexes) for the full list.

## Parsers

### TypeScript/TSX — `parser.ts` (`oxc-parser`)

Uses the Rust-based `oxc-parser` via NAPI bindings to parse TypeScript/TSX/JS/JSX files into an AST. Extracts:

- **Symbols**: Functions, arrow functions, classes, interfaces, type aliases, enums — with reconstructed signatures including generic type parameters (e.g. `<T extends Base>`), return type annotations (e.g. `: Promise<void>`), class/interface heritage (`extends`, `implements`). Class methods, properties, getters, and setters are extracted as individual symbols with `parent_name` pointing to their class
- **JSDoc**: Leading `/** … */` comments attached to symbols via `doc_comment` column (cleaned: `*` prefixes stripped, tags preserved)
- **JSDoc visibility**: A line-leading `@public` / `@private` / `@internal` / `@alpha` / `@beta` tag is parsed once at extract time and stored in the `symbols.visibility` column — `WHERE visibility = 'beta'` becomes a structured query instead of a `LIKE '%@beta%'` regex. Backticked references inside prose (`@public` mentioned in a paragraph) intentionally don't match — the regex anchors on line-start. Helper: `extractVisibility(doc)` exported from `parser.ts`
- **Enum members**: String and numeric values for each member, stored as JSON in the `members` column (e.g. `[{"name":"Active","value":"active"}]`)
- **Const values**: Literal values (`string`, `number`, `boolean`, `null`, `as const`, simple template literals) stored in the `value` column
- **Type members**: Properties and method signatures of interfaces and object-literal type aliases, stored in the `type_members` table
- **Call graph**: Function-scoped call edges stored in the `calls` table — deduped per (caller_scope, callee) per file. Captures `obj.method()` and `this.method()` patterns
- **Symbol nesting**: `parent_name` column tracks scope (nested functions → parent function, class members → class name)
- **Imports**: All `import` statements with specifiers, source paths, and type-only flags
- **Exports**: Named exports, default exports, re-exports
- **Components**: React components detected via PascalCase name + (JSX return **or** hook usage). A PascalCase function in `.tsx`/`.jsx` that neither returns JSX nor calls hooks is indexed only as a symbol, not a component. Extracts props type and hooks used
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
3. Filters changed files to those with a known extension **or** already present in the `files` table (so custom-extension files indexed during `--full` are re-indexed on subsequent incremental runs)
4. Only re-indexes changed files (SHA-256 content comparison), using DB-sourced `indexedPaths` for import resolution (skips full `collectFiles()` glob scan)
5. Deleted files are removed via `ON DELETE CASCADE` — deleting from `files` cascades to all related tables
6. Falls back to full rebuild if commit history is incompatible (e.g. force push, branch switch)

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

Batches of 500 rows per `INSERT ... VALUES (...),(...),(...)` statement reduce per-statement overhead (parse, plan, execute cycle) significantly.

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

When `SCHEMA_VERSION` changes, the indexer auto-detects the mismatch and triggers a full rebuild — no manual intervention needed.

## SQLite Performance Configuration

### `bun:sqlite` API

All DDL and PRAGMA statements use `Database.run()`. The `sqlite-db.ts` wrapper abstracts both Bun (`bun:sqlite`) and Node (`better-sqlite3`). On Bun, `Database.query()` caches compiled statements internally. On Node, the wrapper maintains a `Map<string, Statement>` cache so repeated `run()` and `query()` calls with the same SQL reuse a single prepared statement. Read queries use the wrapper's `.query().all()` or `.get()`. Bulk inserts use the generic `batchInsert<T>()` helper with multi-row `INSERT ... VALUES (...),(...),(...)` in batches of 500, pre-computed placeholders, and zero-copy index-bounds iteration.

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

Read-only query paths (`printQueryResult`, `queryRows`) call `closeDb` with `{ readonly: true }`, which skips both PRAGMAs to avoid write contention under concurrent `codemap query` processes.

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
