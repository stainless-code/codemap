# Glossary

Canonical definitions of Codemap terms. Disambiguates pairs that look similar (TS shape vs SQL table, recipe vs query, hub vs barrel) and pins the SQL-table names so cross-references are unambiguous.

When introducing a new domain noun in a PR, add or update its entry here per [README § Rules for Agents (Rule 9)](./README.md#rules-for-agents).

## Sorting

Alphabetical, lowercase. Disambiguation pairs link to each other.

## Conventions

- **TS shape** = a TypeScript interface or type alias.
- **SQLite table** = an actual on-disk table in `.codemap.db`.
- **Recipe** = a cataloged SQL recipe loaded by `src/application/recipes-loader.ts` from `templates/recipes/<id>.{sql,md}` (bundled) or `<projectRoot>/.codemap/recipes/<id>.{sql,md}` (project-local). Exposed via `codemap query --recipe <id>` and the `codemap://recipes` MCP resource. See [§ R recipe](#recipe).
- **Query** = any SQL run against the index (recipe or ad-hoc).

---

## A

### `.agents/`

Repo-level directory holding **rules** (`.agents/rules/<name>.md`) and **skills** (`.agents/skills/<name>/SKILL.md`). Source of truth; IDE-agnostic. Mirrored to `.cursor/rules/` via per-file symlinks per [agents-first-convention](../.agents/rules/agents-first-convention.md).

### adapter

See **language adapter**.

### agent rule

A `.agents/rules/<name>.md` file with YAML frontmatter. Distinct from a **skill** (longer, scenario-specific). Distinct from a **bundled recipe** (which is SQL, not Markdown).

### audit

Two-snapshot structural-drift command: `codemap audit --baseline <prefix>` (or `--<delta>-baseline <name>`) diffs the live `.codemap.db` against per-delta saved baselines (B.6) and emits `{head, deltas}` where each `deltas[<key>]` carries `{base, added, removed}`. v1 ships three deltas: `files`, `dependencies`, `deprecated`. Each delta pins a canonical SQL projection (in `V1_DELTAS`) and a required-columns list — projects baseline rows down to that subset before diffing so schema bumps that add columns don't break pre-bump baselines. Distinct from `codemap query --baseline` (that's one query, one diff; audit composes multiple per-delta diffs into one envelope). Distinct from `fallow audit` (that runs code-quality verdicts — dead code, dupes, complexity — which are explicit non-goals per [`roadmap.md` § Non-goals (v1)](./roadmap.md#non-goals-v1); codemap audit stays structural).

---

## B

### barrel file

In Codemap usage: a file with a high number of `exports` rows — typically a public-API hub like `src/index.ts`. Surfaced by the `barrel-files` recipe. Distinct from **hub** below — barrel measures _exports out_, hub measures _imports in_.

### batch insert

The shared `batchInsert<T>()` helper in `src/db.ts`. Splits inserts into multi-row `INSERT … VALUES (…),(…)` statements of `BATCH_SIZE` (500) rows each, with pre-computed placeholder strings. Used by every `insertX` function.

### `bun:sqlite`

Bun's native SQLite binding. Codemap uses it on Bun; falls back to `better-sqlite3` on Node. Both are wrapped by `src/sqlite-db.ts` so call sites are runtime-agnostic.

### `better-sqlite3`

Synchronous Node.js SQLite binding. The Node-side counterpart to `bun:sqlite`. Allows **one statement per `prepare()`**, unlike `bun:sqlite` which accepts multiple — see [packaging § Node vs Bun](./packaging.md#node-vs-bun).

---

## C

### `calls` (table)

Function-scoped call edges, deduped per `(caller_scope, callee_name)` per file. **`caller_scope`** is dot-joined enclosing scope (e.g. `UserService.run`). Module-level calls are excluded. See `CallRow` for the TS shape.

### `CallRow`

TS shape for one row of the `calls` table. Maps 1:1 to the SQLite columns.

### category

The extraction path a file took during parsing. One of `ts`, `css`, or `text`. Stored on `ParsedFile.category`, not on a SQLite table. See `ParsedFile`.

### `.codemap.db`

The on-disk SQLite database file at `<project_root>/.codemap.db`. Always accompanied by `.codemap.db-wal` and `.codemap.db-shm` while open (WAL mode). Gitignored via the `.codemap.*` pattern that `codemap agents init` ensures.

### `codemap context`

CLI subcommand emitting a JSON envelope (`ContextEnvelope`) with project metadata, top hubs, sample markers, recipe catalog, and optional intent classification via `--for "<intent>"`.

### `codemap validate`

CLI subcommand comparing on-disk SHA-256 against `files.content_hash`. Statuses: `stale | missing | unindexed`. Exits `1` on any drift.

### `components` (table)

React components (PascalCase + JSX return or hook usage). PascalCase functions that neither return JSX nor call hooks stay in `symbols` only — never `components`. `hooks_used` is JSON-encoded. See `ComponentRow`.

### `content_hash`

Column on the `files` table. Lowercase SHA-256 hex of file bytes computed by `src/hash.ts`. Drives incremental staleness detection (`getChangedFiles`) and powers the `files-hashes` recipe + `codemap validate` CLI.

### `ContextEnvelope`

TS shape for the JSON emitted by `codemap context`. Stable contract; agents can key off field names.

### covering index

A SQLite index that includes every column needed by a query, so SQLite reads everything from the index B-tree without touching the main table. The query plan shows `USING COVERING INDEX`. Used heavily for AI agent query patterns — see [architecture § Covering indexes](./architecture.md#covering-indexes).

### `css_classes` (table)

CSS class names from selectors (no leading `.`). `is_module = 1` for `.module.css` files. See `CssClassRow`.

### `css_keyframes` (table)

`@keyframes <name>` declarations. See `CssKeyframeRow`.

### `css_variables` (table)

CSS custom properties (`--token: value`). `scope` is `:root`, `@theme` (Tailwind v4), or the selector text. See `CssVariableRow`.

---

## D

### DDL

Data Definition Language — the `CREATE TABLE` / `CREATE INDEX` strings in `src/db.ts`. Distinct from **schema** (the conceptual structure) and from **`SCHEMA_VERSION`** (the integer that triggers auto-rebuild on mismatch).

### `dependencies` (table)

Resolved file-to-file edges derived from `imports.resolved_path`. Composite primary key `(from_path, to_path)`. Self-edges and unresolved imports are excluded. `STRICT, WITHOUT ROWID`. See `DependencyRow`.

### `DependencyRow`

TS shape for one row of the `dependencies` table.

---

## E

### existence test

The 4-criterion gate for whether a doc earns its place — see [README § Existence test](./README.md#existence-test-apply-on-every-doc-touching-pr). Forces deletion of stale docs.

### `exports` (table)

Named, default, and re-exports. `kind` is `value` / `type` / `re-export`; `re_export_source` is non-null only for `re-export` rows. See `ExportRow`.

### `ExportRow`

TS shape for one row of the `exports` table.

---

## F

### fan-in

Number of edges _into_ a file in the `dependencies` table — `COUNT(*) FROM dependencies WHERE to_path = ?`. Surfaces as the `fan-in` recipe (top files by inbound edges, i.e. **hubs**).

### fan-out

Number of edges _out of_ a file — `COUNT(*) FROM dependencies WHERE from_path = ?`. Surfaces as the `fan-out` recipe.

### `files` (table)

Header row for every indexed file. `path` is the primary key; all other tables FK to it with `ON DELETE CASCADE`. See `FileRow`.

### `FileRow`

TS shape for one row of the `files` table. Distinct from the `files` SQLite table itself (the table name is lowercase plural; the TS interface is PascalCase singular).

### fixture

Hand-crafted source tree under `fixtures/minimal/` used as the corpus for golden tests. Excluded from oxlint via `ignorePatterns: ["fixtures"]` so auto-fixes never mutate test corpora.

### full rebuild

Index mode that drops every table and rebuilds from scratch — `codemap --full` or `cm.index({ mode: "full" })`. Triggers automatically when `SCHEMA_VERSION` mismatches or when no previous index exists. Optimized via worker threads, deferred index creation, and relaxed PRAGMAs.

---

## G

### `getMeta` / `setMeta`

Read/write helpers for the `meta` key-value table. Stores `schema_version`, `last_indexed_commit`, `indexed_at`, etc.

### glob

Include patterns (relative to project root) used to find indexable files. Defaults in `DEFAULT_INCLUDE_PATTERNS`. Implemented via `tinyglobby` on Node and `Bun.Glob` on Bun (both emit POSIX paths).

### golden test

A `bun scripts/query-golden.ts` regression that compares a query/recipe's output against a checked-in JSON snapshot. Tier A uses `fixtures/minimal/`; Tier B uses external trees via `CODEMAP_*`. See [golden-queries.md](./golden-queries.md).

---

## H

### hash

SHA-256 hex computed over file bytes via `src/hash.ts`. Same algorithm on Bun and Node — `Bun.hash` is **not** used because it differs across runtimes.

### hub

A file with high **fan-in** — many other files import it. Surfaced by the `fan-in` recipe (which we historically also called `hubs`). Distinct from **barrel file** (high _fan-out_ via exports).

---

## I

### incremental index

Index mode that diffs against `last_indexed_commit` (git) and only re-indexes changed files. Default mode (no flag); falls back to full rebuild if commit history is incompatible.

### `imports` (table)

Raw `import` statements. `specifiers` is JSON-encoded; `resolved_path` is non-null only when the resolver could map `source` to an indexed file. See `ImportRow` and the resolved view `dependencies`.

### `ImportRow`

TS shape for one row of the `imports` table.

### `IndexPerformanceReport`

TS shape emitted under `IndexRunStats.performance` when `--performance` is set. Per-phase timing + top-10 slowest files. Note: `total_ms` is `indexFiles` wall-clock and excludes `collect_ms`.

### `IndexResult`

Public TS shape returned from `Codemap#index()` and `runCodemapIndex()`. Wall-clock + row counts + optional performance report.

---

## L

### language adapter

A `LanguageAdapter` registered in `src/adapters/builtin.ts` that maps file extensions to a parser (`parse(ctx) → ParsedFilePayload`). Currently three built-ins: `builtin.ts-js` (oxc), `builtin.css` (lightningcss), `builtin.text` (markers-only). Future community adapters can register additional ones.

### `last_indexed_commit`

`meta` key holding the HEAD SHA at the end of the previous successful index run. Used by `getChangedFiles` to compute the changed set.

### lightningcss

Rust-based CSS parser (NAPI bindings). Codemap's `src/css-parser.ts` uses its visitor pattern to extract custom properties, classes, keyframes, and `@import` sources. Not a preprocessor — Sass / Less / SCSS are out of scope.

---

## M

### `codemap mcp` / MCP server

Stdio MCP (Model Context Protocol) server exposing codemap's structural-query surface to agent hosts (Claude Code, Cursor, Codex, generic MCP clients) as JSON-RPC tools — eliminates the bash round-trip on every agent invocation. v1 ships one tool per CLI verb (`query`, `query_batch`, `query_recipe`, `audit`, `save_baseline`, `list_baselines`, `drop_baseline`, `context`, `validate`) plus four lazy-cached resources (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`). Tool input/output keys are snake_case — Codemap's convention, matching the patterns in MCP spec examples and reference servers (GitHub MCP, Cursor built-ins); the spec itself doesn't mandate it. CLI stays kebab — translation lives at the MCP-arg layer. Output shape is verbatim from the CLI's `--json` envelope (no re-mapping). Bootstrap once at server boot; tool handlers reuse engine entry-points (`executeQuery` / `runAudit` / etc.). Distinct from `codemap serve` (HTTP API — v1.x backlog). Implementation: `src/cli/cmd-mcp.ts` (CLI shell) + `src/application/mcp-server.ts` (engine). See [`architecture.md` § MCP wiring](./architecture.md#cli-usage).

### `query_batch` (MCP-only tool)

MCP tool with no CLI counterpart — runs N read-only SQL statements in one round-trip. Items are `string | {sql, summary?, changed_since?, group_by?}`: bare strings inherit batch-wide flag defaults; object form overrides on a per-key basis. Output is an N-element array; per-element shape mirrors single-`query`'s output for that statement's effective flag set. Per-statement errors are isolated (failed statement returns `{error}` in its slot; siblings still execute). Distinct from making `query` accept `;`-delimited batches (rejected — would need a SQL tokenizer and would diverge `query`'s output shape from its CLI counterpart). SQL-only (no `recipe` polymorphism); `query_recipe_batch` is an additive future change if a real consumer asks.

### markers

`TODO` / `FIXME` / `HACK` / `NOTE` comments extracted from any indexed file (TS, CSS, Markdown, JSON, YAML, …). Stored in the `markers` table; surfaced by the `markers-by-kind` recipe. See `MarkerRow`.

### `MarkerRow`

TS shape for one row of the `markers` table.

### `meta` (table)

Key-value metadata table. Holds `schema_version`, `last_indexed_commit`, `indexed_at`, `file_count`, `project_root`. `STRICT, WITHOUT ROWID`.

---

## O

### oxc-parser

Rust-based TypeScript / JavaScript parser (NAPI bindings). Codemap's `src/parser.ts` uses it to extract symbols, imports, exports, components, type members, calls, and markers from `.ts` / `.tsx` / `.js` / `.jsx` (and `.mts` / `.cts` / `.mjs` / `.cjs`).

### oxc-resolver

Rust-based import-path resolver (NAPI bindings). Configured with `tsconfig.json` for alias resolution (`~/utils/foo`). Produces the `dependencies` table from `imports.resolved_path`.

### oxlint

Rust-based linter. Configured in `.oxlintrc.json`. Auto-fixes most violations via `bun run lint:fix`.

### oxfmt

Rust-based formatter. Run via `bun run format` / `format:check`.

---

## P

### `ParsedFile`

TS shape returned by parse workers and built up by language adapters. Header (`relPath`, `fileRow`, `category`, `parseMs?`) plus optional row arrays per category (TS / CSS / text). Subset that adapters populate is `ParsedFilePayload`.

### parser

Code that turns source bytes into structured rows. Three implementations: `parser.ts` (oxc), `css-parser.ts` (lightningcss), `markers.ts` (regex). Distinct from **adapter** — an adapter wires a parser to a set of file extensions.

### plan

A `docs/plans/<feature-name>.md` file tracking in-flight work. Created on commit; deleted when the feature ships per [README § Rule 3](./README.md#rules-for-agents).

### pointer file

A managed root-level file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`) with a `<!-- codemap-pointer:begin -->` / `<!-- codemap-pointer:end -->` section. Written by `codemap agents init`. See [agents.md § Pointer files](./agents.md#pointer-files).

---

## Q

### query

Any SQL run against `.codemap.db` — either a **recipe** (bundled SQL) or ad-hoc. Distinct from **query-recipes.ts** (the file that holds bundled recipe SQL strings).

### query baseline

A snapshot of a query result set saved by `codemap query --save-baseline[=<name>]` and replayed by `codemap query --baseline[=<name>]` for added/removed diffs. Stored in the `query_baselines` table inside `.codemap.db` (no parallel JSON files; survives `--full` and `SCHEMA_VERSION` rebuilds because the table is intentionally absent from `dropAll()`). Default name = `--recipe` id; ad-hoc SQL must pass an explicit name. Diff identity is per-row `JSON.stringify` equality — exact match, no fuzzy "changed" category in v1.

### query recipe

See **recipe**.

---

## R

### recipe

A SQL file (plus optional sibling `.md` description) loaded into the catalog by `src/application/recipes-loader.ts`. Two sources, same shape:

- **Bundled** — ships in the npm package as `templates/recipes/<id>.{sql,md}`. Examples: `fan-in`, `deprecated-symbols`, `files-hashes`.
- **Project-local** — loaded from `<projectRoot>/.codemap/recipes/<id>.{sql,md}` (root-only resolution; not gitignored — meant to be checked in for team review).

Run via `codemap query --recipe <id>` (alias `-r`). Project recipes win on id collision with bundled ones (entries carry `shadows: true` in the catalog so agents reading `codemap://recipes` at session start see when a recipe behaves differently from the documented bundled version). Per-row `actions` templates (kebab-case verb + description) live in YAML frontmatter on each `<id>.md` — uniform between bundled and project. Load-time validation rejects empty SQL and DML / DDL keywords; runtime `PRAGMA query_only=1` (PR #35) is the parser-proof backstop. Distinct from an ad-hoc **query** (any SQL string the agent composes itself; ad-hoc SQL never carries actions).

### `recipe shadows`

Boolean flag on a project-local recipe entry that has the same `id` as a bundled recipe — `shadows: true` means "this project recipe overrides what the bundled version would have done." Surfaces in `--recipes-json`, `codemap://recipes`, and `codemap://recipes/{id}` so agents can see overrides without parsing per-execution responses (per-execution shape stays unchanged for plan § 4 uniformity). Silent at runtime — the agent-facing skill prompt is the channel that tells agents to check the flag at session start.

### research

A snapshot-style note under `docs/research/` capturing a competitive scan or evaluation. Closed per [README § Closing research](./README.md#closing-research) — adopted items are slimmed to a "What shipped" appendix; rejected items keep a status header.

### resolver

`oxc-resolver`, configured by `src/resolver.ts`. Maps import specifiers to absolute file paths using `tsconfig` aliases.

### `ResolvedCodemapConfig`

TS shape after `resolveCodemapConfig()` fills defaults and absolutifies paths. Stored in process-global runtime by `initCodemap`. Distinct from **`CodemapUserConfig`** (the user-facing input shape with optional fields).

### roadmap

`docs/roadmap.md`. Forward-looking only; shipped items are removed (see [README § Rule 2](./README.md#rules-for-agents)). Holds the canonical [Non-goals (v1)](./roadmap.md#non-goals-v1) list.

### row

One record in a SQLite table. Each table has a corresponding TS interface (`FileRow`, `SymbolRow`, …) so reads via `db.query<RowType>(sql).all()` are typed.

---

## S

### schema

Conceptually, the structure of the SQLite database — every table, column, constraint, and index. Defined by **DDL** in `src/db.ts`. Versioned by **`SCHEMA_VERSION`**. Documented in [architecture § Schema](./architecture.md#schema).

### `SCHEMA_VERSION`

Integer constant in `src/db.ts`. Bumped whenever the DDL changes. `createSchema()` reads `meta.schema_version` and triggers a full rebuild on mismatch.

### show

`codemap show <name>` — one-step lookup that returns metadata (`file_path:line_start-line_end` + `signature` + `kind`) for the symbol(s) matching `<name>` (exact, case-sensitive). Output is the `{matches, disambiguation?}` envelope (single match → `{matches: [{...}]}`; multi-match adds `disambiguation: {n, by_kind, files, hint}` so agents narrow without scanning every row). Flags: `--kind <kind>` (filter by `symbols.kind`), `--in <path>` (file-scope filter — directory prefix or exact file). Distinct from **snippet** (returns source text, not just metadata) and from `query` with `WHERE name = ?` (one verb vs SQL composition; see [`architecture.md` § Show / snippet wiring](./architecture.md#cli-usage)).

### snippet

`codemap snippet <name>` — same lookup as **show**, but each match also carries `source` (file lines from disk at `line_start..line_end`), `stale` (true when content_hash drifted since last index — line range may have shifted), and `missing` (true when file is gone). Per-execution shape mirrors `show`'s envelope; source/stale/missing are additive fields. Stale-file behavior: `source` is ALWAYS returned when the file exists; `stale: true` is metadata the agent reads (no refusal, no auto-reindex side-effects from a read tool — agent decides whether to act on possibly-shifted lines or run `codemap` first). See [`architecture.md` § Show / snippet wiring](./architecture.md#cli-usage).

### SARIF

[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) — Static Analysis Results Interchange Format. JSON envelope GitHub Code Scanning consumes natively. Codemap emits SARIF via `codemap query --format sarif` (or `format: "sarif"` on the MCP `query` / `query_recipe` tools). Rule id is `codemap.<recipe-id>` for `--recipe`; `codemap.adhoc` for ad-hoc SQL. Location columns auto-detected (`file_path` / `path` / `to_path` / `from_path` priority; `line_start` + optional `line_end` for region). Aggregate recipes (`index-summary`, `markers-by-kind`) emit `results: []` + a stderr warning. Incompatible with `--summary` / `--group-by` / baseline (different output shapes). Default `result.level` is `"note"`; per-recipe override deferred to v1.x. See [`architecture.md` § Output formatters](./architecture.md#cli-usage).

### GH annotations

`::notice file=<path>,line=<n>::<message>` — [GitHub Actions workflow command](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message) that surfaces a finding inline on the PR diff without writing a custom Action wrapper. Codemap emits annotations via `codemap query --format annotations` (or `format: "annotations"` on the MCP query tools). One line per locatable row; rows without a location are skipped. Default level `notice`; `warning` and `error` overrides supported via the `level` parameter (CLI exposes only the default for v1; per-recipe override comes with the same v1.x frontmatter that grants per-recipe SARIF severity).

### skill

A `.agents/skills/<name>/SKILL.md` file with YAML frontmatter. Longer than a rule; describes a complete agent workflow. Distinct from a **rule** (shorter, normative).

### `STRICT`

SQLite per-table option enforcing column types at insert time. Every Codemap table uses `STRICT`.

### `symbols` (table)

Functions / consts / classes / interfaces / types / enums, plus class members (`method`, `property`, `getter`, `setter`). Class members carry `parent_name`. JSDoc tags in `doc_comment` power the `deprecated-symbols` and `visibility-tags` recipes; `members` is JSON for enums. See `SymbolRow`.

### `SymbolRow`

TS shape for one row of the `symbols` table.

---

## T

### targeted reindex

Index mode that re-parses only the explicit file paths passed to `--files`. Skips git diff and the full glob. See `targetedReindex` in `src/application/index-engine.ts`.

### `templates/agents`

The `templates/agents/` directory shipped with the npm package. Source for `codemap agents init`, which copies (or symlinks, in interactive mode) the bundled rules and skills into the consumer's `.agents/`.

### tinyglobby

The Node-side glob implementation. Returns POSIX-separated paths regardless of OS — same as `Bun.Glob` and `git`. Why `cmd-validate.ts` normalizes its inputs to POSIX.

### tracer bullet

A small end-to-end vertical slice (see [`.cursor/rules/tracer-bullets.mdc`](../.cursor/rules/tracer-bullets.mdc)). Used in PRs to validate the critical path before expanding.

### `type_members` (table)

Properties and method signatures on interfaces and object-literal types. `symbol_name` references the parent `symbols.name`. `type` is null when the parser can't reconstruct the annotation. See `TypeMemberRow`.

### `TypeMemberRow`

TS shape for one row of the `type_members` table.

---

## V

### visibility tag

A JSDoc tag controlling export visibility — `@public`, `@internal`, `@private`, `@alpha`, `@beta`. Parsed from `doc_comment` at parse time (line-leading match) and stored in the `symbols.visibility` column (TEXT, NULL when no tag). The `visibility-tags` recipe filters on `WHERE visibility IS NOT NULL`. `@deprecated` is a related but separate JSDoc tag — surfaced via `WHERE doc_comment LIKE '%@deprecated%'` in the `deprecated-symbols` recipe (no dedicated column; deprecation is orthogonal to visibility, not a 6th value).

---

## W

### WAL

Write-Ahead Log mode. Set by `PRAGMA journal_mode = WAL` on every `openDb()`. Why `.codemap.db-wal` and `.codemap.db-shm` files exist alongside `.codemap.db`. Allows concurrent readers during writes.

### `WITHOUT ROWID`

SQLite per-table option that stores data directly in the primary key B-tree, eliminating a rowid lookup indirection. Used on `dependencies` (composite PK) and `meta` (single-column TEXT PK).

### worker pool

Parallel parse workers in `src/worker-pool.ts`. Bun `Worker` on Bun, Node `worker_threads` on Node. Used during full rebuild only — incremental and targeted indexing run sequentially.
