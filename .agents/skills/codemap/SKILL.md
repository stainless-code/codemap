---
name: codemap
description: Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by Codemap.
---

# Codemap — full reference

Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by **Codemap**.

## Bundled content (stay generic)

Examples below use **placeholders** (`'...'`, `getConfig`, `~/lib/api`, etc.) — not a real product tree. **Shipped skill and rules stay generic** so they apply to any repo.

**This repository:** run the CLI with **`bun src/index.ts`** (same as **`bun run dev`**). **Consumer / npm** copy of this skill lives under **`templates/agents/skills/codemap/`** (installed with **`codemap agents init`**). Edit **`.agents/`** here for Codemap development; **do not** treat it as the published package layout.

**Run queries:**

```bash
bun src/index.ts query --json "<SQL>"
```

**Human-readable:** Omit **`--json`** to print **`console.table`** (optional; wide results use more space than JSON).

After **`bun run build`**, **`node dist/index.mjs query …`** or a linked **`codemap`** binary matches the published CLI. Use **`--root`** / **`CODEMAP_ROOT`** to index another tree.

## Query output and agents

- **`bun src/index.ts query --json`** (default in examples above) prints a **JSON array** of row objects to stdout on success.
- **On failure**, stdout is a single object **`{"error":"<message>"}`** and the process exits **1**. This covers **invalid SQL**, **database open errors**, and **`query` bootstrap failures** (config load, resolver setup), not only SQL parse/runtime errors. The CLI sets **`process.exitCode`** instead of calling **`process.exit`**, so piped stdout is not cut off mid-stream.
- The CLI **does not cap** how many rows SQLite returns — add **`LIMIT`** and **`ORDER BY`** in SQL when you need a bounded list.
- When answering with structural facts from the index (lists of paths, symbols, dependency edges), **ground the answer in the query rows** — do not invent or silently drop rows. Use **`--json`** for large or multi-column results.

## Agent-friendly SQL recipes

Replace placeholders (`'...'`) with your module path, file glob, or symbol name.

**CLI shortcuts:** **`bun src/index.ts query --json --recipe <id>`** runs bundled SQL (preferred for agents). **`bun src/index.ts query --recipe <id>`** without **`--json`** prints a table. **`bun src/index.ts query --recipes-json`** prints every bundled recipe (**`id`**, **`description`**, **`sql`**, optional **`actions`**) as JSON (no index / DB required). **`bun src/index.ts query --print-sql <id>`** prints one recipe’s SQL only. Ids include **`fan-out`**, **`fan-out-sample`** (**`GROUP_CONCAT`** samples), **`fan-out-sample-json`** (same, but **`json_group_array`** — needs SQLite JSON1), **`fan-in`**, **`index-summary`**, **`files-largest`**, **`components-by-hooks`**, **`markers-by-kind`**, **`deprecated-symbols`**, **`visibility-tags`**, **`barrel-files`**, **`files-hashes`** — see **`bun src/index.ts query --help`**.

**Output flags** (compose with **`--recipe`** or ad-hoc SQL):

- **`--summary`** — counts only. With **`--json`**: **`{"count": N}`**. With **`--group-by`**: **`{"group_by": "<mode>", "groups": [{key, count}]}`**.
- **`--changed-since <ref>`** — post-filter rows by **`path`** / **`file_path`** / **`from_path`** / **`to_path`** / **`resolved_path`** against **`git diff --name-only <ref>...HEAD ∪ git status --porcelain`**. Rows with no recognised path column pass through.
- **`--group-by owner|directory|package`** — partition into buckets and emit **`{"group_by", "groups": [{key, count, rows}]}`**. **`owner`** reads CODEOWNERS (last matching rule wins); **`directory`** is the first path segment; **`package`** uses **`package.json`** **`workspaces`** or **`pnpm-workspace.yaml`**. **Mutually exclusive with `--save-baseline` / `--baseline`.**
- **`--save-baseline[=<name>]`** — snapshot the result rows to the **`query_baselines`** table inside `<state-dir>/index.db` (default `.codemap/index.db`; no parallel JSON files; survives `--full` and SCHEMA bumps). Name defaults to the `--recipe` id; ad-hoc SQL needs an explicit `=<name>`. Re-saving with the same name overwrites in place.
- **`--baseline[=<name>]`** — diff the current result against the saved baseline. Output `{baseline:{...}, current_row_count, added: [...], removed: [...]}` (with `--json`) or a two-section terminal dump. Identity = per-row multiset equality (canonical `JSON.stringify` keyed frequency map; duplicates preserved). Pair with `--summary` for `{baseline:{...}, current_row_count, added: N, removed: N}`. **Mutually exclusive with `--group-by`.**
- **`--baselines`** lists saved baselines (no `rows_json` payload); **`--drop-baseline <name>`** deletes one. Both reject every other flag — they're list-only / drop-only operations.
- **Per-row recipe `actions`** — recipes that define an **`actions: [{type, auto_fixable?, description?}]`** template append it to every row in **`--json`** output (recipe-only; ad-hoc SQL never carries actions). Under `--baseline`, actions attach to the **`added`** rows only (the rows the agent should act on). Inspect via **`--recipes-json`**.
- **Project-local recipes** — drop **`<id>.sql`** (and optional **`<id>.md`** for description body + actions) into **`<state-dir>/recipes/`** (default `<projectRoot>/.codemap/recipes/`) to make team-internal SQL a first-class CLI verb. `--recipes-json` and the `codemap://recipes` MCP resource list project recipes alongside bundled ones with **`source: "bundled" | "project"`** discriminating them. Project recipes win on id collision; entries that override a bundled id carry **`shadows: true`** so agents reading the catalog at session start know when a recipe behaves differently from the documented bundled version. `<id>.md` supports YAML frontmatter for the per-row action template — **block-list shape only** (loader's hand-rolled parser; no inline-flow `[{...}]`): `---\nactions:\n  - type: my-verb\n    auto_fixable: false\n    description: "..."\n---`. Validation: SQL is rejected at load time if it starts with DML/DDL (DELETE/DROP/UPDATE/etc.); the runtime `PRAGMA query_only=1` is the parser-proof backstop. `.codemap/index.db` is gitignored; **`.codemap/recipes/` is NOT** — recipes are git-tracked source code authored for human review.

**Audit (`bun src/index.ts audit`)** — separate top-level command for structural-drift verdicts. Composes B.6 baselines into a per-delta `{head, deltas}` envelope; v1 ships `files` / `dependencies` / `deprecated`. Two snapshot-source shapes:

- **`--baseline <prefix>`** — auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` in `query_baselines`. Slots that don't exist are silently absent (the convention-following user just saves what they need). **If no slot resolves at all** (every auto-resolved name is missing AND no `--<delta>-baseline` flag is passed), audit exits 1 — never produces an empty envelope.
- **`--<delta>-baseline <name>`** — explicit per-delta override (e.g. `--files-baseline X --dependencies-baseline Y`). Names must exist or audit exits 1. Composes with `--baseline` (per-delta flag overrides one slot).

Each emitted delta carries its own `base` metadata so mixed-baseline audits are first-class. `--summary` collapses each delta to `{added: N, removed: N}`. `--no-index` skips the auto-incremental-index prelude (default is to re-index first so `head` reflects current source). v1 ships no `verdict` / threshold config — `codemap audit --json | jq -e '.deltas.dependencies.added | length <= 50'` is the CI exit-code idiom until v1.x ships native thresholds. Each delta pins a canonical SQL projection and validates baseline column-set membership before diffing — schema-bump-resilient (extras dropped, missing columns surface a clean re-save command).

**MCP server (`bun src/index.ts mcp [--watch] [--debounce <ms>]`)** — separate top-level command that exposes the entire CLI surface to agent hosts (Claude Code, Cursor, Codex, generic MCP clients) as JSON-RPC tools over stdio. Eliminates the bash round-trip on every agent call. Bootstrap once at server boot; tool handlers reuse the existing engine entry-points (`executeQuery`, `runAudit`, etc.) so output shape is verbatim from each tool's CLI counterpart's `--json` envelope. With `--watch` (or `CODEMAP_WATCH=1`), boots a co-process file watcher so every tool reads a live index — and `audit`'s incremental-index prelude becomes a no-op (saves the per-request reindex cost).

**HTTP server (`bun src/index.ts serve [--host 127.0.0.1] [--port 7878] [--token <secret>] [--watch] [--debounce <ms>]`)** — same tool taxonomy as MCP, exposed over `POST /tool/{name}` for non-MCP consumers (CI scripts, simple `curl`, IDE plugins that don't speak MCP). Loopback-default; optional Bearer-token auth. Output shape is the `codemap query --json` envelope (NOT MCP's `{content: [...]}` wrapper); SARIF / annotations payloads ship with `application/sarif+json` / `text/plain` Content-Type. Resources mirrored at `GET /resources/{encoded-uri}`. `GET /health` is auth-exempt; `GET /tools` / `GET /resources` are catalogs. Same `application/tool-handlers.ts` + `resource-handlers.ts` MCP uses — no engine duplication. Same `--watch` + `--debounce` semantics as `mcp` — for IDE / CI scripts that hit the API repeatedly, `serve --watch` removes the per-query staleness anxiety.

**Watch mode (`bun src/index.ts watch [--debounce 250] [--quiet]`)** — standalone long-running process that debounces file changes and re-indexes only the changed paths via `runCodemapIndex({mode: 'files'})`. SIGINT/SIGTERM drains pending edits before exit. Use `mcp --watch` / `serve --watch` for the in-process killer combo; use `codemap watch` standalone when you want the watcher decoupled from a transport (e.g. running alongside an editor that already speaks MCP via a different process).

**Tools (snake_case keys — Codemap convention matching MCP spec examples + reference servers; spec is convention-agnostic. CLI stays kebab; translation lives at the MCP-arg layer.):**

- **`query`** — one SQL statement. Args: `{sql, summary?, changed_since?, group_by?, format?}`. Same envelope as `codemap query --json`. Pass `format: "sarif"` or `"annotations"` to receive a formatted text payload (SARIF 2.1.0 doc / `::notice` lines); ad-hoc SQL gets `rule.id = codemap.adhoc`. Format is incompatible with `summary` / `group_by` (parser rejects with a structured `{error}`).
- **`query_batch`** — MCP-only, no CLI counterpart. Args: `{statements: (string | {sql, summary?, changed_since?, group_by?})[], summary?, changed_since?, group_by?}`. Items are bare SQL strings (inherit batch-wide flag defaults) or objects (override on a per-key basis). Output is N-element array; per-element shape mirrors single-`query`'s output for that statement's effective flag set. Per-statement errors are isolated — failed statements return `{error}` in their slot; siblings still execute. SQL-only (no `recipe` polymorphism in items). `format` deferred to v1.x — annotation/sarif on a heterogeneous batch is awkward; call `query` per recipe instead.
- **`query_recipe`** — `{recipe, summary?, changed_since?, group_by?, format?}`. Resolves the recipe id to SQL + per-row actions, then executes like `query`. Unknown recipe id returns a structured `{error}` pointing at the `codemap://recipes` resource. With `format: "sarif"`, `rule.id = codemap.<recipe>`, `rule.shortDescription` = recipe description, `rule.fullDescription` = the recipe's `<id>.md` body.
- **`audit`** — `{base?, baseline_prefix?, baselines?: {files?, dependencies?, deprecated?}, summary?, no_index?}`. Composes per-delta snapshots into the `{head, deltas}` envelope. Two **primary** sources are mutually exclusive: `base: <ref>` (git committish — worktree+reindex against any committish; sha-keyed cache under `.codemap/audit-cache/`; sub-100ms second run; requires git, errors cleanly on non-git projects) OR `baseline_prefix: "<prefix>"` (auto-resolve `<prefix>-{files,dependencies,deprecated}` from `query_baselines`). Plus optional **per-delta overrides** via `baselines: {<key>: <name>}` that compose with either primary source. Per-delta `base.source` is `"ref"` (with `base.ref` + `base.sha`) or `"baseline"` (with `base.name` + `base.sha`). Auto-runs incremental index unless `no_index: true`; watch-active sessions skip the prelude automatically.
- **`save_baseline`** — polymorphic `{name, sql? | recipe?}` with runtime exclusivity check (mirrors the CLI's single `--save-baseline=<name>` verb). Pass exactly one of `sql` or `recipe`.
- **`list_baselines`** — no args; returns the array `codemap query --baselines --json` would print.
- **`drop_baseline`** — `{name}`. Returns `{dropped: <name>}` on success or `isError` if the name doesn't exist.
- **`context`** — `{compact?, intent?}`. Returns the project-bootstrap envelope (codemap version, schema version, file count, language breakdown, hubs, sample markers). Designed for agent session-start — one call replaces 4-5 `query` calls.
- **`validate`** — `{paths?: string[]}`. Compares on-disk SHA-256 to indexed `files.content_hash`; empty `paths` validates everything. Returns rows with status (`ok`/`stale`/`missing`/`unindexed`).
- **`show`** — `{name, kind?, in?}`. Exact, case-sensitive symbol name lookup. Returns `{matches: [{name, kind, file_path, line_start, line_end, signature, ...}], disambiguation?: {n, by_kind, files, hint}}`. Single match → `{matches: [{...}]}`; multi-match adds the disambiguation envelope so you narrow without re-scanning. Fuzzy lookup belongs in `query` with `LIKE`.
- **`snippet`** — `{name, kind?, in?}`. Same lookup as `show` but each match also carries `source` (file lines from disk at `line_start..line_end`), `stale` (true when content_hash drifted since indexing — line range may have shifted), `missing` (true when file is gone). Per Q-6 (settled): `source` is always returned when the file exists; agent decides whether to act on stale content or run `codemap` / `codemap --files <path>` to re-index first. No auto-reindex side-effects from this read tool.
- **`impact`** — `{target, direction?, via?, depth?, limit?, summary?}`. Symbol/file blast-radius walker — replaces hand-composed `WITH RECURSIVE` queries that agents struggle to write reliably. `target` is a symbol name (case-sensitive, exact) OR a project-relative file path (auto-detected by `/` or by matching `files.path`). `direction`: `up` (callers / dependents), `down` (callees / dependencies), `both` (default). `via`: `dependencies`, `calls`, `imports`, `all` (default — every backend compatible with the resolved target kind: symbol → `calls`; file → `dependencies` + `imports`; mismatched explicit choices land in `skipped_backends`, no error). `depth` default 3, `0` = unbounded (still cycle-detected and limit-capped). `limit` default 500. `summary: true` trims `matches` for cheap CI-gate consumption (`jq '.summary.nodes'`) but preserves the count. Result: `{target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by: 'depth'|'limit'|'exhausted'}}`. Cycle detection is approximate-but-bounded — bounded depth + `LIMIT` keep cyclic graphs cheap; `terminated_by` reports the dominant stop reason. SARIF / annotations not supported (impact rows are graph traversals, not findings).

**Resources (lazy-cached on first `read_resource`; constant for server-process lifetime):**

- **`codemap://recipes`** — full catalog JSON (same as `--recipes-json`). Each entry carries `source: "bundled" | "project"` and `shadows: true` on project entries that override a bundled recipe id. Read this at session start so you know when a `--recipe foo` call will run a project override instead of the documented bundled version.
- **`codemap://recipes/{id}`** — single recipe `{id, description, body?, sql, actions?, source, shadows?}`. Replaces `--print-sql <id>`.
- **`codemap://schema`** — DDL of every table in `.codemap/index.db` (queried live from `sqlite_schema`).
- **`codemap://skill`** — full text of bundled `templates/agents/skills/codemap/SKILL.md`. Agents that don't preload the skill at session start can fetch it here.

**Implementation:** `src/cli/cmd-mcp.ts` (CLI shell — argv + lifecycle) + `src/application/mcp-server.ts` (transport — SDK glue). Tool bodies live in `src/application/tool-handlers.ts` (pure transport-agnostic — same handlers `codemap serve` dispatches over HTTP); resource fetchers in `src/application/resource-handlers.ts`. Mirrors the `cmd-audit.ts ↔ audit-engine.ts` seam. `--changed-since` git lookups are memoised per `(root, ref)` pair across batch items so a `query_batch` of N items sharing the same ref does one git invocation, not N.

**Determinism:** Bundled recipes use stable secondary **`ORDER BY`** tie-breakers (and ordered inner **`LIMIT`** samples where applicable). Prefer **`--recipe`** over pasting SQL when you need the maintained ordering. **Canonical SQL** is **`src/cli/query-recipes.ts`** (`QUERY_RECIPES`).

The blocks below match **`fan-out`** and **`fan-out-sample`** in **`QUERY_RECIPES`**; other recipes align with “Conditional aggregation”, “Codebase statistics”, and component sections later in this skill.

**Top files by dependency fan-out** (`fan-out`):

```sql
SELECT from_path, COUNT(*) AS deps
FROM dependencies
GROUP BY from_path
ORDER BY deps DESC, from_path ASC
LIMIT 10
```

**Same ranking, plus up to five sample targets per file** (`fan-out-sample`):

```sql
SELECT d.from_path,
  COUNT(*) AS deps,
  (SELECT GROUP_CONCAT(to_path, ' | ')
   FROM (SELECT to_path FROM dependencies d2 WHERE d2.from_path = d.from_path ORDER BY to_path ASC LIMIT 5))
    AS sample_targets
FROM dependencies d
GROUP BY d.from_path
ORDER BY deps DESC, d.from_path ASC
LIMIT 10
```

**JSON array samples (JSON1):** use **`bun src/index.ts query --json --recipe fan-out-sample-json`** — or replace **`GROUP_CONCAT`** with **`json_group_array(to_path)`** in the inner subquery if your SQLite build has JSON1.

## Schema

### `files` — Every indexed file

| Column        | Type    | Description                                                                      |
| ------------- | ------- | -------------------------------------------------------------------------------- |
| path          | TEXT PK | Relative path from project root                                                  |
| content_hash  | TEXT    | SHA-256 hex digest                                                               |
| size          | INTEGER | File size in bytes                                                               |
| line_count    | INTEGER | Number of lines                                                                  |
| language      | TEXT    | `ts`, `tsx`, `js`, `jsx`, `css`, `md`, `mdx`, `mdc`, `json`, `yaml`, `sh`, `txt` |
| last_modified | INTEGER | Unix timestamp (ms)                                                              |
| indexed_at    | INTEGER | When this file was last indexed                                                  |

### `symbols` — Functions, types, interfaces, enums, constants, classes

| Column            | Type       | Description                                                                                                                        |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| id                | INTEGER PK | Auto-increment ID                                                                                                                  |
| file_path         | TEXT FK    | References `files(path)`                                                                                                           |
| name              | TEXT       | Symbol name                                                                                                                        |
| kind              | TEXT       | `function`, `class`, `type`, `interface`, `enum`, `const`                                                                          |
| line_start        | INTEGER    | Start line (1-based)                                                                                                               |
| line_end          | INTEGER    | End line (1-based)                                                                                                                 |
| signature         | TEXT       | Reconstructed signature with generics and return types                                                                             |
| is_exported       | INTEGER    | 1 if exported                                                                                                                      |
| is_default_export | INTEGER    | 1 if default export                                                                                                                |
| members           | TEXT       | JSON enum members (NULL for non-enums)                                                                                             |
| doc_comment       | TEXT       | Leading JSDoc text (cleaned), NULL when absent                                                                                     |
| value             | TEXT       | Literal value for consts (`"ok"`, `42`, `true`, `null`)                                                                            |
| parent_name       | TEXT       | Enclosing symbol name (class/function), NULL = top-level                                                                           |
| visibility        | TEXT       | Line-leading JSDoc tag: `public` / `private` / `internal` / `alpha` / `beta`; NULL when absent. First match in document order wins |

### `calls` — Function-scoped call edges (deduped per file)

| Column       | Type       | Description                                     |
| ------------ | ---------- | ----------------------------------------------- |
| id           | INTEGER PK | Auto-increment ID                               |
| file_path    | TEXT FK    | References `files(path)`                        |
| caller_name  | TEXT       | Calling function/method name                    |
| caller_scope | TEXT       | Dot-joined scope path (e.g. `MyClass.run`)      |
| callee_name  | TEXT       | Called function, `obj.method`, or `this.method` |

### `type_members` — Properties of interfaces and object-literal type aliases

| Column      | Type       | Description                                        |
| ----------- | ---------- | -------------------------------------------------- |
| id          | INTEGER PK | Auto-increment ID                                  |
| file_path   | TEXT FK    | References `files(path)`                           |
| symbol_name | TEXT       | Parent interface / type alias name                 |
| name        | TEXT       | Property or method name                            |
| type        | TEXT       | Type annotation (e.g. `string`, `(key) => number`) |
| is_optional | INTEGER    | 1 if `?` modifier                                  |
| is_readonly | INTEGER    | 1 if `readonly` modifier                           |

### `imports` — Import statements

| Column        | Type    | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| file_path     | TEXT FK | The importing file                              |
| source        | TEXT    | Raw import source (e.g. `~/lib/utils`, `react`) |
| resolved_path | TEXT    | Resolved file path, NULL for external packages  |
| specifiers    | TEXT    | JSON array of imported names                    |
| is_type_only  | INTEGER | 1 if `import type`                              |
| line_number   | INTEGER | Line of the import statement                    |

### `exports` — Export manifest

| Column           | Type    | Description                                   |
| ---------------- | ------- | --------------------------------------------- |
| file_path        | TEXT FK | The exporting file                            |
| name             | TEXT    | Exported name (`default` for default exports) |
| kind             | TEXT    | `value`, `type`, `re-export`                  |
| is_default       | INTEGER | 1 if default export                           |
| re_export_source | TEXT    | Source module for re-exports                  |

### `components` — React components (TSX files)

| Column            | Type    | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| file_path         | TEXT FK | Component file                                               |
| name              | TEXT    | Component name (PascalCase)                                  |
| props_type        | TEXT    | Props type/interface name, if detected                       |
| hooks_used        | TEXT    | JSON array of hooks called (e.g. `["useState", "useQuery"]`) |
| is_default_export | INTEGER | 1 if default export                                          |

### `dependencies` — File-to-file dependency graph

| Column    | Type    | Description             |
| --------- | ------- | ----------------------- |
| from_path | TEXT FK | The file that imports   |
| to_path   | TEXT    | The file being imported |

### `markers` — TODO/FIXME/HACK/NOTE comments

| Column      | Type    | Description                     |
| ----------- | ------- | ------------------------------- |
| file_path   | TEXT FK | File containing the marker      |
| line_number | INTEGER | Line number (1-based)           |
| kind        | TEXT    | `TODO`, `FIXME`, `HACK`, `NOTE` |
| content     | TEXT    | The marker text                 |

### `css_variables` — CSS custom properties (design tokens)

| Column      | Type    | Description                                         |
| ----------- | ------- | --------------------------------------------------- |
| file_path   | TEXT FK | CSS file containing the variable                    |
| name        | TEXT    | Variable name (e.g. `--blue-50`, `--text-h1`)       |
| value       | TEXT    | Parsed value (e.g. `rgb(215, 225, 242)`, `3rem`)    |
| scope       | TEXT    | Where defined: `:root`, `@theme`, or selector scope |
| line_number | INTEGER | Line number (1-based)                               |

### `css_classes` — CSS class definitions

| Column      | Type    | Description                     |
| ----------- | ------- | ------------------------------- |
| file_path   | TEXT FK | CSS file containing the class   |
| name        | TEXT    | Class name (without `.` prefix) |
| is_module   | INTEGER | 1 if from a `.module.css` file  |
| line_number | INTEGER | Line number (1-based)           |

### `css_keyframes` — @keyframes animation definitions

| Column      | Type    | Description                       |
| ----------- | ------- | --------------------------------- |
| file_path   | TEXT FK | CSS file containing the keyframes |
| name        | TEXT    | Animation name                    |
| line_number | INTEGER | Line number (1-based)             |

### `meta` — Index metadata

| Key                   | Value                             |
| --------------------- | --------------------------------- |
| `last_indexed_commit` | Git SHA of HEAD when last indexed |
| `indexed_at`          | ISO timestamp of last index       |
| `file_count`          | Total files indexed               |
| `project_root`        | Absolute path to project          |
| `schema_version`      | Schema version number             |

### `query_baselines` — Saved query result snapshots (user data)

User-facing baselines saved by `codemap query --save-baseline`, replayed by `codemap query --baseline`. **Survives `--full` and SCHEMA bumps** — intentionally absent from `dropAll()`.

| Column     | Type    | Description                                                                              |
| ---------- | ------- | ---------------------------------------------------------------------------------------- |
| name       | TEXT PK | User-supplied name; defaults to the `--recipe` id (ad-hoc SQL requires an explicit name) |
| recipe_id  | TEXT    | The `--recipe` id when known; NULL for ad-hoc SQL                                        |
| sql        | TEXT    | The SQL that produced the snapshot                                                       |
| rows_json  | TEXT    | Canonical `JSON.stringify(rows)` — multiset diff identity (duplicate rows preserved)     |
| row_count  | INTEGER | Cached number of rows in the saved result set                                            |
| git_ref    | TEXT    | `git rev-parse HEAD` at save time, or NULL when not a git working tree                   |
| created_at | INTEGER | `Date.now()` at save time (epoch ms)                                                     |

### `coverage` — Statement coverage (user data, ingested via `codemap ingest-coverage`)

Static coverage from Istanbul JSON or LCOV. Joinable to `symbols` for "what's untested?" queries. **Survives `--full` and SCHEMA bumps** — intentionally absent from `dropAll()`. Empty until first ingest.

| Column           | Type    | Description                                                                                              |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| file_path        | TEXT PK | Project-relative path; matches `symbols.file_path`. Forward-slashed (Windows paths normalised on ingest) |
| name             | TEXT PK | Symbol name (matches `symbols.name`). Same `(file_path, name, line_start)` is unique by construction     |
| line_start       | INT PK  | Symbol's starting line (matches `symbols.line_start`). Disambiguates re-declared names                   |
| coverage_pct     | REAL    | Percentage 0.0–100.0; `NULL` when `total_statements = 0` (zero-statement scope; not the same as 0%)      |
| hit_statements   | INTEGER | Count of statements with non-zero hit count after innermost-wins projection                              |
| total_statements | INTEGER | Count of statements that projected onto this symbol                                                      |

Three meta keys (`coverage_last_ingested_at` / `_path` / `_format`) record freshness — single ingest at a time, format is meta-level.

## Query patterns

### Basic lookups

```sql
-- Find a symbol definition
SELECT name, kind, file_path, line_start, line_end, signature
FROM symbols WHERE name = 'getConfig';

-- Fuzzy symbol search
SELECT name, kind, file_path, line_start
FROM symbols WHERE name LIKE '%Config%' ORDER BY name;

-- All exported symbols from a file
SELECT name, kind, signature
FROM symbols WHERE file_path LIKE '%settings-provider%' AND is_exported = 1;

-- Enum values (what are the valid members of an enum?)
SELECT name, members FROM symbols
WHERE kind = 'enum' AND name = 'TransactionStatus';

-- Interface / type shape (what fields does a type have?)
SELECT name, type, is_optional, is_readonly FROM type_members
WHERE symbol_name = 'UserSession';

-- Deprecated symbols (find @deprecated via JSDoc)
SELECT name, kind, file_path, doc_comment FROM symbols
WHERE doc_comment LIKE '%@deprecated%';

-- Visibility-tagged symbols (parsed JSDoc tag — single column, no regex)
SELECT name, kind, visibility, file_path
FROM symbols WHERE visibility IS NOT NULL ORDER BY visibility, file_path;

-- Just the @beta surface (filter on the parsed tag, not doc_comment LIKE)
SELECT name, kind, file_path FROM symbols WHERE visibility = 'beta';

-- Symbol documentation
SELECT name, signature, doc_comment FROM symbols
WHERE name = 'formatCurrency' AND doc_comment IS NOT NULL;

-- Const values (config flags, magic strings)
SELECT name, value, file_path FROM symbols
WHERE kind = 'const' AND value IS NOT NULL AND name LIKE '%URL%';

-- Class methods (what does class X expose?)
SELECT name, kind, signature FROM symbols
WHERE parent_name = 'UserService' ORDER BY name;

-- Top-level symbols only (skip nested helpers)
SELECT name, kind, signature FROM symbols
WHERE parent_name IS NULL AND file_path LIKE '%utils%';

-- Who calls function X? (fan-in)
SELECT DISTINCT caller_name, file_path FROM calls
WHERE callee_name = 'fetchUser';

-- What does function X call? (fan-out)
SELECT DISTINCT callee_name FROM calls
WHERE caller_name = 'processUser';

-- Most-called functions (hotspots)
SELECT callee_name, COUNT(*) as fan_in FROM calls
GROUP BY callee_name ORDER BY fan_in DESC LIMIT 10;

-- File overview (imports + exports)
SELECT 'import' as dir, source as name, specifiers as detail
FROM imports WHERE file_path LIKE '%OrderRow%'
UNION ALL
SELECT 'export', name, kind FROM exports WHERE file_path LIKE '%OrderRow%';
```

### Dependency analysis

**Use `DISTINCT`** on dependency and import queries — a file importing multiple specifiers from the same module produces duplicate rows.

```sql
-- Who imports a module by its alias? (matches raw import source string)
SELECT DISTINCT file_path FROM imports WHERE source LIKE '~/lib/api%';

-- Direct dependents (who imports this file? uses resolved paths)
SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%format-date%';

-- Direct dependencies (what does this file import?)
SELECT DISTINCT to_path FROM dependencies WHERE from_path LIKE '%OrderRow%';

-- Most-imported files (hotspots)
SELECT to_path, COUNT(*) as importers
FROM dependencies GROUP BY to_path ORDER BY importers DESC LIMIT 15;

-- Most complex files (most dependencies)
SELECT from_path, COUNT(*) as dep_count
FROM dependencies GROUP BY from_path ORDER BY dep_count DESC LIMIT 15;

-- Circular dependencies (1-hop)
SELECT a.from_path, a.to_path
FROM dependencies a
JOIN dependencies b ON a.to_path = b.from_path AND b.to_path = a.from_path;

-- Orphan files (no one imports them, excluding test and story files)
SELECT f.path FROM files f
LEFT JOIN dependencies d ON d.to_path = f.path
WHERE d.from_path IS NULL
  AND f.path NOT LIKE '%.test.%'
  AND f.path NOT LIKE '%.stories.%'
ORDER BY f.path;
```

### Component analysis

```sql
-- Components using a specific hook
SELECT name, file_path, hooks_used
FROM components WHERE hooks_used LIKE '%useTheme%';

-- Components with most hooks (complexity indicator)
-- `json_array_length` requires SQLite JSON1. For a portable ranking, use
-- `bun src/index.ts query --json --recipe components-by-hooks` (comma-based count on the stored JSON array).
SELECT name, file_path,
  json_array_length(hooks_used) as hook_count
FROM components ORDER BY hook_count DESC LIMIT 15;

-- Components with props types
SELECT name, file_path, props_type
FROM components WHERE props_type IS NOT NULL ORDER BY name;
```

### CSS analysis

```sql
-- All design tokens (color palette)
SELECT name, value, scope FROM css_variables
WHERE name LIKE '--blue%' OR name LIKE '--gray%' ORDER BY name;

-- Tailwind theme tokens
SELECT name, value FROM css_variables WHERE scope = '@theme' LIMIT 20;

-- All CSS module classes in a file
SELECT name FROM css_classes
WHERE file_path LIKE '%ProductCard%' AND is_module = 1;

-- All keyframe animations
SELECT name, file_path FROM css_keyframes;

-- Token categories (grouped by prefix)
SELECT
  substr(name, 1, instr(substr(name, 3), '-') + 2) as prefix,
  COUNT(*) as count
FROM css_variables
GROUP BY prefix ORDER BY count DESC;
```

### Efficient pagination (cursor-based)

For large result sets, avoid `OFFSET` — use cursor-based pagination with the last-seen value:

```sql
-- First page
SELECT name, kind, file_path, line_start FROM symbols
WHERE is_exported = 1
ORDER BY name LIMIT 50;

-- Next page (use last name from previous result as cursor)
SELECT name, kind, file_path, line_start FROM symbols
WHERE is_exported = 1 AND name > 'lastSeenName'
ORDER BY name LIMIT 50;
```

### Conditional aggregation (single query for multiple counts)

```sql
-- Instead of multiple COUNT(*) queries, use conditional aggregation:
SELECT
  (SELECT COUNT(*) FROM files) as files,
  (SELECT COUNT(*) FROM symbols) as symbols,
  (SELECT COUNT(*) FROM imports) as imports,
  (SELECT COUNT(*) FROM components) as components,
  (SELECT COUNT(*) FROM dependencies) as dependencies;
```

### Codebase statistics

```sql
-- Files by language
SELECT language, COUNT(*) as count FROM files GROUP BY language;

-- Symbols by kind
SELECT kind, COUNT(*) as count FROM symbols GROUP BY kind ORDER BY count DESC;

-- Exported vs internal symbols
SELECT
  SUM(is_exported) as exported,
  COUNT(*) - SUM(is_exported) as internal
FROM symbols;

-- Largest files
SELECT path, line_count, size FROM files ORDER BY line_count DESC LIMIT 15;

-- All TODO/FIXME markers
SELECT kind, COUNT(*) as count FROM markers GROUP BY kind;
```

## Maintenance

From this repository (same flags as the published **`codemap`** binary):

```bash
# Targeted — re-index only specific files you just modified
bun src/index.ts --files path/to/file.tsx path/to/other.ts

# Incremental — auto-detects changes via git
bun src/index.ts

# Full rebuild — after rebase, branch switch, or stale index
bun src/index.ts --full

# Check index freshness
bun src/index.ts query --json "SELECT key, value FROM meta"
```

**Prefer `--files`** when you know which files you changed — it skips git diff and filesystem scanning for the rest of the tree. Deleted files passed to `--files` are auto-removed from the index.

**End-user / npm** commands: **`templates/agents/skills/codemap/SKILL.md`** ( **`npx @stainless-code/codemap`**, **`codemap`** on **`PATH`**, etc.).

## Troubleshooting

| Problem                    | Solution                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Stale results after rebase | Run **`bun src/index.ts --full`** (or **`codemap --full`** when exercising the packaged CLI)                           |
| Missing file in results    | Check exclude / include globs in **`codemap.config.ts`**, **`codemap.config.json`**, or defaults in **`src/index.ts`** |
| `resolved_path` is NULL    | Import is an external package (not in project)                                                                         |
| Resolver errors            | Verify `tsconfig.json` paths (or **`tsconfigPath`** in config) when resolving aliases                                  |
