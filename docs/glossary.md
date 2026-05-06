# Glossary

Canonical definitions of Codemap terms. Disambiguates pairs that look similar (TS shape vs SQL table, recipe vs query, hub vs barrel) and pins the SQL-table names so cross-references are unambiguous.

When introducing a new domain noun in a PR, add or update its entry here per [README § Rules for Agents (Rule 9)](./README.md#rules-for-agents).

## Sorting

Alphabetical, lowercase. Disambiguation pairs link to each other.

## Conventions

- **TS shape** = a TypeScript interface or type alias.
- **SQLite table** = an actual on-disk table in `.codemap/index.db`.
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

### `codemap apply` / apply tool

Substrate-shaped fix executor — reads the same `{file_path, line_start, before_pattern, after_pattern}` row contract `--format diff-json` emits and applies the hunks to disk. Recipe SQL is the synthesis surface; codemap is the executor (Moat-A clean — verdict-shape "should we fix this?" stays on the recipe author). CLI: `codemap apply <recipe-id> [--params k=v[,k=v]] [--dry-run] [--yes] [--json]`. MCP: `apply` tool. HTTP: `POST /tool/apply`. **Phase 1** validates every row against current disk via `actual.includes(before_pattern)` (substring match — mirrors `buildDiffJson`'s contract); collects five conflict reasons (`file missing` / `line out of range` / `line content drifted` / `path escapes project root` / `duplicate edit on same line`). The path-containment guard rejects absolute `file_path` inputs and `../`-traversal that resolves outside `projectRoot`; the overlap guard rejects two-or-more rows targeting the same `(file_path, line_start)`. **Phase 2** (gated on `!dryRun && conflicts.length === 0`) writes each modified file via sibling temp + `renameSync` for POSIX-atomic per-file writes, with `$`-pre-escape on `after_pattern` per `String.prototype.replace` GetSubstitution rule. **Q2 (c) all-or-nothing** — any conflict in any file aborts phase 2 entirely; partial writes never ship. **Q6 gate** — TTY no `--yes` triggers a `Proceed? [y/N]` prompt (default-N) on stderr; non-TTY contexts (CI / agents / MCP / HTTP) require `--yes` (or `yes: true`) explicitly. Result envelope (Q5; identical across modes): `{mode, applied, files, conflicts, summary}`. Re-running on already-applied code reports a `line content drifted` conflict whose `actual_at_line` shows the post-rename content — user re-runs `codemap` to refresh the index, then re-runs apply for a vacuous clean pass (Q7). Engine: `application/apply-engine.ts` (pure; `applyDiffPayload`). Boundary: only `cli/cmd-apply.ts` + `application/tool-handlers.ts` may import the engine — re-runnable kit at [`docs/architecture.md` § Boundary verification — apply write path](./architecture.md#boundary-verification--apply-write-path). Floor "No fix engine" preserved — codemap doesn't synthesise edits, it only executes the hunks the recipe row described.

### audit

Two-snapshot structural-drift command: `codemap audit` diffs the live `.codemap/index.db` against a base snapshot and emits `{head, deltas}` where each `deltas[<key>]` carries `{base, added, removed}`. v1 ships three deltas: `files`, `dependencies`, `deprecated`. Each delta pins a canonical SQL projection (in `V1_DELTAS`) and a required-columns list — projects baseline rows down to that subset before diffing so schema bumps that add columns don't break pre-bump baselines. Three mutually-exclusive top-level snapshot sources: `--baseline <prefix>` (auto-resolve `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` from `query_baselines`), `--<delta>-baseline <name>` (explicit per-delta — composes with the others), and `--base <ref>` (worktree + reindex against a git committish — see § A `audit --base`). Distinct from `codemap query --baseline` (that's one query, one diff; audit composes multiple per-delta diffs into one envelope). Distinct from code-quality audit tools (e.g. `knip` for unused exports, `jscpd` for duplication, framework-specific complexity linters) — those produce verdicts on dead code / dupes / complexity, which are explicit non-goals per [`roadmap.md` § Non-goals (v1)](./roadmap.md#non-goals-v1); codemap audit stays structural.

### `audit --base <ref>` / git-ref baseline

Ad-hoc audit snapshot from any git committish (`origin/main`, `HEAD~5`, `<sha>`, tag, …). `git worktree add` materialises `<ref>` to `<projectRoot>/.codemap/audit-cache/<sha>/`, codemap reindexes into the worktree's `.codemap/index.db`, then per-delta canonical SQL runs on that DB vs the live one. Cache key is the **resolved sha** (`git rev-parse --verify`), so `--base origin/main` and `--base <sha>` (when they point at the same commit) share one cache entry. **Atomic populate** — per-pid temp dir + POSIX `rename`; concurrent processes resolving the same sha race-safely without lock files. Eviction: hardcoded LRU 5 entries / 500 MiB. Per-delta `base.source` is `"ref"` (vs `"baseline"`) and the delta carries `base.ref` (user-supplied string) + `base.sha` (resolved). Mutually exclusive with `--baseline <prefix>`; composes orthogonally with per-delta `--<delta>-baseline <name>` overrides. Hard error on non-git projects (no graceful fallback — there's no meaningful "ref" without git). Both transports (MCP `audit` tool's `base?` arg, HTTP `POST /tool/audit`) call the same `runAuditFromRef` engine in `application/audit-engine.ts`.

---

## B

### barrel file

In Codemap usage: a file with a high number of `exports` rows — typically a public-API hub like `src/index.ts`. Surfaced by the `barrel-files` recipe. Distinct from **hub** below — barrel measures _exports out_, hub measures _imports in_.

### batch insert

The shared `batchInsert<T>()` helper in `src/db.ts`. Splits inserts into multi-row `INSERT … VALUES (…),(…)` statements of `BATCH_SIZE` (500) rows each, with pre-computed placeholder strings. Used by every `insertX` function.

### `boundaries` (config) / `boundary_rules` (table) / `boundary-violations` (recipe)

Architecture-boundary substrate. Users declare `boundaries: [{name, from_glob, to_glob, action?}]` in `.codemap/config.ts`; the resolver fills `action` to `"deny"` when omitted. Every index pass calls `reconcileBoundaryRules` (in `src/db.ts`) which clears `boundary_rules` and re-inserts from the resolved config — config is the single source of truth, the table is a denormalised lookup. Bundled `boundary-violations` recipe joins `dependencies` × `boundary_rules` via SQLite `GLOB` and surfaces forbidden import edges; `--format sarif` lights up automatically because the recipe row aliases `dependencies.from_path` to `file_path`. CHECK constraint pins `action ∈ {'deny','allow'}`. v1 only honours `'deny'`; `'allow'` reserves the slot for future whitelist semantics. See [architecture.md § `boundary_rules`](./architecture.md#boundary_rules--architecture-boundary-rules-config-derived-strict-without-rowid).

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

### `.codemap/` / `<state-dir>` / `CODEMAP_STATE_DIR`

The codemap state directory under `<project_root>` — holds every codemap-managed file: `index.db` (+ WAL / SHM), `audit-cache/<sha>/`, project-local `recipes/`, `config.{ts,js,json}`, and the self-managed `.gitignore` (per plan §D7 + D11). Default name `.codemap/`; override via `--state-dir <path>` CLI or `CODEMAP_STATE_DIR` env (relative paths resolve against `<project_root>`). Resolved at bootstrap, not via the config file (chicken-and-egg). Engine: `src/application/state-dir.ts` (`resolveStateDir`).

### `.codemap/index.db` (the index)

The on-disk SQLite database file at `<state-dir>/index.db` (default `<project_root>/.codemap/index.db`). Always accompanied by `index.db-wal` and `index.db-shm` while open (WAL mode). Gitignored by the self-managed `<state-dir>/.gitignore` written by `ensureStateGitignore`.

### `.codemap/.gitignore` / self-healing files

Codemap-managed `.gitignore` inside `<state-dir>/` (blacklist of generated artifacts; tracked sources `recipes/` + `config.*` default to tracked). Reconciled on every codemap boot by `ensureStateGitignore` (`src/application/state-dir.ts`) — read → compare to canonical → write only on drift. **Bumping the canonical body in a future PR IS the migration**: every consumer's project repairs itself on next codemap run. Same self-healing pattern (`ensure*` reconciler, idempotent, drift-detect) governs `<state-dir>/config.json` (`ensureStateConfig` in `src/application/state-config.ts` — prunes unknown keys, sorts keys, never touches user-authored TS/JS configs). Inspired by flowbite-react's `setup-*` shape; expressed in codemap's own conventions per plan §D11.

### `codemap context`

CLI subcommand emitting a JSON envelope (`ContextEnvelope`) with project metadata, top hubs, sample markers, recipe catalog, and optional intent classification via `--for "<intent>"`.

### `--ci` (CLI flag)

CI-aggregate flag on `codemap query` and `codemap audit`. Aliases `--format sarif` + `process.exitCode = 1` on findings/additions + suppresses the no-locatable-rows stderr warning (CI templates would surface it as red noise; the row-set is the gating signal). Mutually exclusive with `--json` (different format aliases) and with `--format <other>` (contradicts the alias); `--ci --format sarif` redundant but accepted. Designed for the GitHub Marketplace Action's headline default (`audit --base ${{ github.base_ref }} --ci`); independently useful for any non-Action CI consumer.

### `codemap validate`

CLI subcommand comparing on-disk SHA-256 against `files.content_hash`. Statuses: `stale | missing | unindexed`. Exits `1` on any drift.

### `components` (table)

React components (PascalCase + JSX return or hook usage). PascalCase functions that neither return JSX nor call hooks stay in `symbols` only — never `components`. `hooks_used` is JSON-encoded. See `ComponentRow`.

### `symbols.complexity` / cyclomatic complexity / McCabe

Per-function decision-point count (REAL column on `symbols`). Computed by the parser walker (`src/parser.ts`) per the McCabe formula: `1 + (decision points)`. Counted nodes: `if`, `while`, `do…while`, `for`, `for…in`, `for…of`, `case X:` (not `default:` — that's the fall-through arm, not a decision), `&&`, `||`, `??`, `?:`, `catch`. Function-shaped symbols only — non-functions (interfaces, types, enums, plain consts) and class methods get `complexity = NULL` (v1 limitation; class methods tracked under `high-complexity-untested.md`). Joins to `coverage` via `(file_path, name, line_start)` natural key for the bundled `high-complexity-untested` recipe (complexity ≥ 10 ⨯ coverage < 50%).

### `source_fts` (FTS5 virtual table) / `--with-fts` / opt-in full-text

Opt-in FTS5 virtual table over file content (`tokenize='porter unicode61'`). Always created (near-zero space when empty); populated only when the resolved config has FTS5 enabled (`.codemap/config.ts` `fts5: true` OR `--with-fts` CLI flag at index time; CLI wins, logs stderr override). Demonstrates the FTS5 ⨯ `symbols` ⨯ `coverage` JOIN composability that ripgrep can't match — bundled recipe `text-in-deprecated-functions` exemplifies the JOIN. Toggle change auto-detects via `meta.fts5_enabled` and forces a full rebuild so `source_fts` is consistently populated. Stderr telemetry `[fts5] source_fts populated: <N> files / <X> KB` on first populate. Distinct from arbitrary full-text storage — the table is structurally identical to `coverage` (both `WITHOUT ROWID`-class virtual tables in the substrate). Default OFF preserves `.codemap/index.db` size for non-users (~30–50% growth on text-heavy projects).

### `--format mermaid` / `formatMermaid` / `MERMAID_MAX_EDGES`

Output mode rendering `{from, to, label?, kind?}` rows as a Mermaid `flowchart LR` diagram. Sibling of `--format sarif` / `--format annotations` in `application/output-formatters.ts`. **Bounded-input contract** (50-edge ceiling; `MERMAID_MAX_EDGES`) — unbounded inputs reject with a scope-suggestion error naming the recipe + count + scoping knobs (`LIMIT` / `--via` / `WHERE`). Auto-truncation explicitly out of scope (would be a verdict masquerading as output mode, violating the predicate-as-API moat). Recipes / ad-hoc SQL must alias columns to the `{from, to}` shape (e.g. `SELECT from_path AS "from", to_path AS "to" FROM dependencies LIMIT 50`).

### `coverage` (table)

Statement coverage ingested from Istanbul JSON, LCOV, or V8 runtime (`NODE_V8_COVERAGE=...` directory via `--runtime`) via `codemap ingest-coverage <path>`. Natural-key PK `(file_path, name, line_start)` — intentionally **not** a FK to `symbols.id` because `symbols` re-creates with fresh AUTOINCREMENT ids on every `--full` reindex; the natural-key approach lets coverage rows survive that churn (`coverage` is also intentionally absent from `dropAll()`, joins the `query_baselines` precedent). Columns: `coverage_pct REAL` (`NULL` when `total_statements = 0` — "untested" and "no testable code" are different signals), `hit_statements`, `total_statements`. Orphan rows (file deleted from project) are cleaned by an explicit `DELETE FROM coverage WHERE file_path NOT IN (SELECT path FROM files)` at the end of every ingest. Three meta keys (`coverage_last_ingested_at` / `_path` / `_format`) record freshness — single ingest at a time, so format is meta-level not per-row.

### `codemap ingest-coverage` / Istanbul JSON / LCOV / V8 runtime / static coverage ingestion

`codemap ingest-coverage <path> [--runtime] [--json]` reads a coverage artifact and writes statement-level rows into the `coverage` table. Three formats:

- **Istanbul JSON** (`coverage-final.json`) — emitted natively by `c8`, `nyc`, `vitest --coverage --coverage.reporter=json`, `jest --coverage --coverageReporters=json`. Parser reads `statementMap` + `s` (per-statement hit counts).
- **LCOV** (`lcov.info`) — emitted by `bun test --coverage`, `c8 --reporter=lcov`, every legacy stack. Parser tokenises `SF:` / `DA:<line>,<count>` / `end_of_record` records; ignores `TN:` / `FN:` / `BRDA:` / `LF:` / `LH:` (statement coverage only).
- **V8 runtime** (with `--runtime`) — opt-in directory mode reading `NODE_V8_COVERAGE=...` per-process dumps (`coverage-<pid>-<ts>-<seq>.json`). Each script's byte-offset ranges are converted to per-line hit counts (innermost-wins: smaller ranges override the function-as-a-whole count). Skips non-`file://` URLs (Node internals, `evalmachine.<anonymous>`); merges duplicate-URL scripts across dumps. Useful for "delete cold code with stronger evidence" agent flows. **Local-only — SaaS aggregation explicitly out of scope** (different product class).

Format auto-detected from extension (`.json` → istanbul, `.info` → lcov, directory → probe both, error if ambiguous); `--runtime` opts into V8 directory mode. Each statement projects onto the **innermost** enclosing symbol via JS-side `(line_end - line_start) ASC` tie-break — required because nested symbols (class methods inside classes, closures inside functions) would otherwise inflate `total_statements`. Statements that fall outside every symbol range (top-level expressions, side-effect imports) increment `skipped.statements_no_symbol` for observability. Three bundled recipes consume the table at first-class agent surface (no agent ever has to hand-compose the JOIN):

- `untested-and-dead` — exported functions with no callers AND zero coverage (the killer recipe; ships with a name-collision mitigation guide in the recipe `.md`).
- `files-by-coverage` — files ranked ascending by statement coverage (replaces a deferred `file_coverage` rollup table; aggregates the symbol-level table via index-bounded `GROUP BY`).
- `worst-covered-exports` — top-20 worst-covered exported functions.

Engine: `application/coverage-engine.ts` — pure `upsertCoverageRows({db, projectRoot, rows, format, sourcePath})` core consumed by `ingestIstanbul`, `ingestLcov`, and `ingestV8`.

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

## G

### GH annotations

`::notice file=<path>,line=<n>::<message>` — [GitHub Actions workflow command](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message) that surfaces a finding inline on the PR diff without writing a custom Action wrapper. Codemap emits annotations via `codemap query --format annotations` (or `format: "annotations"` on the MCP query tools). One line per locatable row; rows without a location are skipped. Property values + message payload are percent-encoded per [actions/toolkit](https://github.com/actions/toolkit/blob/master/packages/core/src/command.ts) so paths with `:` / `,` and messages with `%` round-trip safely. Default level `notice`; `warning` and `error` overrides supported via the `level` parameter (CLI exposes only the default for v1; per-recipe override comes with the same v1.x frontmatter that grants per-recipe SARIF severity).

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

### `codemap impact` / impact tool

Symbol or file blast-radius walker. CLI: `codemap impact <target> [--direction up|down|both] [--depth N] [--via dependencies|calls|imports|all] [--limit N] [--summary] [--json]`. MCP: `impact` tool. HTTP: `POST /tool/impact`. Replaces hand-composed `WITH RECURSIVE` queries that agents struggle to write reliably. Walks compatible graphs based on resolved target kind: **symbol** targets walk `calls` (callers / callees by name); **file** targets walk `dependencies` + `imports` (`resolved_path` only). Mismatched explicit `--via` choices land in `skipped_backends` instead of failing. Cycle-detected via path-string `instr` check inside the recursive CTE; bounded by `--depth` (default 3, 0 = unbounded but still cycle-detected and limit-capped) and `--limit` (default 500). Result envelope: `{target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by: 'depth'|'limit'|'exhausted'}}`. `--summary` trims `matches` for cheap CI gate consumption (`jq '.summary.nodes'`) but preserves the count. Pure transport-agnostic engine in `application/impact-engine.ts`; CLI / MCP / HTTP all dispatch the same `findImpact` function. `sarif` / `annotations` formats not supported (impact rows are graph traversals, not findings).

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

Stdio MCP (Model Context Protocol) server exposing codemap's structural-query surface to agent hosts (Claude Code, Cursor, Codex, generic MCP clients) as JSON-RPC tools — eliminates the bash round-trip on every agent invocation. v1 ships one tool per CLI verb (`query`, `query_batch`, `query_recipe`, `audit`, `save_baseline`, `list_baselines`, `drop_baseline`, `context`, `validate`, `show`, `snippet`, `impact`) plus six resources: **lazy-cached catalog resources** (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`) and **live read-per-call resources** (`codemap://files/{path}` per-file roll-up; `codemap://symbols/{name}` symbol lookup with `?in=<path-prefix>` filter). Tool input/output keys are snake_case — Codemap's convention, matching the patterns in MCP spec examples and reference servers (GitHub MCP, Cursor built-ins); the spec itself doesn't mandate it. CLI stays kebab — translation lives at the MCP-arg layer. Output shape is verbatim from the CLI's `--json` envelope (no re-mapping). Bootstrap once at server boot; tool handlers (in `application/tool-handlers.ts`) are pure transport-agnostic — same handlers `codemap serve` (HTTP) dispatches. Implementation: `src/cli/cmd-mcp.ts` (CLI shell) + `src/application/mcp-server.ts` (engine). See [`architecture.md` § MCP wiring](./architecture.md#cli-usage).

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

### outcome aliases (`dead-code` / `deprecated` / `boundaries` / `hotspots` / `coverage-gaps`)

Top-level CLI verbs that thin-wrap `query --recipe <id>`: `dead-code` → `untested-and-dead`, `deprecated` → `deprecated-symbols`, `boundaries` → `boundary-violations`, `hotspots` → `fan-in`, `coverage-gaps` → `worst-covered-exports`. Every `query` flag passes through (`--json`, `--format`, `--ci`, `--summary`, `--changed-since`, `--group-by`, `--params`, `--save-baseline`, `--baseline`). Mapping lives in `src/cli/aliases.ts` (`OUTCOME_ALIASES`). Capped at 5 to avoid alias-sprawl — promote a sixth only when the recipe becomes a headline outcome. Moat-A clean: the alias is a one-line rewrite, not a new primitive; the recipe IS the SQL.

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

### `pr-comment` (CLI verb)

Markdown PR-summary renderer. `codemap pr-comment <input>` (or `-` for stdin) reads a `codemap audit --json` envelope or a `codemap query --format sarif` doc and emits a markdown comment suitable for `gh pr comment <PR> -F -`. Auto-detects shape via `runs[]` (SARIF) vs `deltas` (audit); `--shape audit|sarif` overrides. Audit-mode groups by delta with collapsed `<details>` for added + removed rows; SARIF-mode groups by `ruleId`. Lists >50 entries collapse to `… and N more`. `--json` envelope `{markdown, findings_count, kind}` is the structured form action.yml consumers read. Targets the surfaces SARIF → Code Scanning doesn't cover (private repos without GHAS, aggregate audit deltas without `file:line` anchors, bot-context seeding). v1.0 ships the (b) summary-comment shape; (c) inline-review comments deferred per Q4 of [`plans/github-marketplace-action.md`](./plans/github-marketplace-action.md). Engine: `application/pr-comment-engine.ts` (pure transport-agnostic).

### pointer file

A managed root-level file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`) with a `<!-- codemap-pointer:begin -->` / `<!-- codemap-pointer:end -->` section. Written by `codemap agents init`. See [agents.md § Pointer files](./agents.md#pointer-files).

---

## Q

### query

Any SQL run against `.codemap/index.db` — either a **recipe** (bundled SQL) or ad-hoc. Distinct from **query-recipes.ts** (the file that holds bundled recipe SQL strings).

### query baseline

A snapshot of a query result set saved by `codemap query --save-baseline[=<name>]` and replayed by `codemap query --baseline[=<name>]` for added/removed diffs. Stored in the `query_baselines` table inside `.codemap/index.db` (no parallel JSON files; survives `--full` and `SCHEMA_VERSION` rebuilds because the table is intentionally absent from `dropAll()`). Default name = `--recipe` id; ad-hoc SQL must pass an explicit name. Diff identity is per-row `JSON.stringify` equality — exact match, no fuzzy "changed" category in v1.

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

### `recipe_recency` (table) / recipe recency / `recipeRecency: false`

Per-recipe `last_run_at` (epoch ms) + `run_count` for agent-host ranking — surfaces inline on every `--recipes-json` entry and the matching `codemap://recipes` / `codemap://recipes/{id}` MCP resources (live read every call; the resource cache was dropped to avoid freezing recency at first-read for the server-process lifetime). Counts only successful recipe runs; failed runs / param-validation rejections / SQL errors don't write. Default ON; opt-out via `.codemap/config` `recipeRecency: false` (short-circuits before any DB write — no rows ever land). 90-day rolling window enforced eagerly on the write path (single transactional `DELETE` + `INSERT … ON CONFLICT` inside `recordRecipeRun`); reads filter at SELECT, never mutate. Local-only — no upload primitive (resists telemetry-creep PRs by construction). Two write sites — `handleQueryRecipe` in `application/tool-handlers.ts` (covers MCP + HTTP) and `runQueryCmd` in `cli/cmd-query.ts` (CLI) — both call `tryRecordRecipeRun` (the failure-isolated wrapper around `recordRecipeRun`) from `application/recipe-recency.ts`. Failure-isolated: a recency-write throw NEVER blocks the recipe response (warning to stderr unless `quiet`). Schema: see [architecture.md § `recipe_recency`](./architecture.md#recipe_recency--per-recipe-last-run--run-count-user-data-strict-without-rowid).

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

### `suppressions` (table) / `// codemap-ignore-next-line` / `// codemap-ignore-file`

Opt-in substrate. Markers parser recognises `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` directives (also `#`, `--`, `<!--`, `/*` leaders for non-JS files) and writes to `suppressions(file_path, line_number, recipe_id)`. Two scopes encoded by `line_number`: positive integer = next-line (the directive sits one line above; `line_number` points at the suppressed line), `0` = file scope. Recipe authors opt in by `LEFT JOIN suppressions s ON s.file_path = … AND s.recipe_id = '<id>' AND (s.line_number = 0 OR s.line_number = <row's line>) WHERE s.id IS NULL`; ad-hoc SQL is unaffected. **Stays consistent with the "no opinionated rule engine" Floor** — no severity, no suppression-by-default, no universal-honor; the suppression is consumer-chosen substrate. The leader regex requires the directive to start a line (modulo whitespace) so it never matches inside string literals — both this clone's tests and recipe `.md` examples use the directive in prose without polluting the index. Bundled recipes that opt in: `untested-and-dead` (next-line + file), `unimported-exports` (file scope only — exports table has no `line_number` column).

### `codemap watch` / watch mode

Long-running process that subscribes to filesystem changes via [chokidar v5](https://github.com/paulmillr/chokidar) and re-indexes only the changed files via `runCodemapIndex({mode: 'files'})`. Eliminates the "is the index stale?" friction every CLI / MCP / HTTP query rides on today: agents in long sessions or multi-step refactors can `query` immediately after editing without remembering to reindex. Debounced (default 250 ms) so a burst — `git checkout`, `npm install`, multi-file save — collapses to one reindex call. Filters event paths the same way the indexer does (TS / TSX / JS / JSX / CSS + project-local recipes; skips `node_modules`, `.git`, `dist`, etc.). SIGINT / SIGTERM drains pending edits before exit. Three shapes:

- **Standalone**: `codemap watch` — foreground process; logs `reindex N file(s) in Mms` per batch unless `--quiet`.
- **Combined with MCP**: `codemap mcp` — boots stdio MCP server + watcher in one process by default since 2026-05; agents never hit a stale index. Pass `--no-watch` to disable.
- **Combined with HTTP**: `codemap serve` — boots HTTP server + watcher by default; CI scripts / IDE plugins read live data. Pass `--no-watch` to disable.

`CODEMAP_WATCH=0` (or `"false"`) is the env-shortcut for opting out of the default-ON watcher on `codemap mcp` / `codemap serve` — useful for IDE / CI launches that can't easily edit the spawn command. `CODEMAP_WATCH=1` still parses for backwards-compat but is now a no-op (it matches the new default). When watch is active, the audit tool's incremental-index prelude becomes a no-op on both transports (the watcher already keeps the index fresh — saves the per-request reindex cost on every `mcp audit` and every `POST /tool/audit`). Implementation: `src/cli/cmd-watch.ts` (CLI shell) + `src/application/watcher.ts` (engine — pure debouncer + chokidar backend; injectable backend for tests). See [`architecture.md` § Watch wiring](./architecture.md#cli-usage).

### `codemap serve` / HTTP server

Long-running HTTP server exposing the same tool taxonomy as `codemap mcp` over `POST /tool/{name}` for non-MCP consumers (CI scripts, simple `curl`, IDE plugins that don't speak MCP). Default bind **`127.0.0.1:7878`** (loopback only — refuse `0.0.0.0` unless explicitly opted in via `--host 0.0.0.0`); optional `--token <secret>` requires `Authorization: Bearer <secret>` on every request. Output shape matches `codemap query --json` (NOT MCP's `{content: [...]}` wrapper — HTTP doesn't need that transport artifact); `format: "sarif"` payloads ship as `application/sarif+json`, `format: "annotations"` as `text/plain`. Routes: `POST /tool/{name}` (every MCP tool), `GET /resources/{encoded-uri}` (mirror of `codemap://recipes` / `schema` / `skill`), `GET /health` (auth-exempt liveness probe), `GET /tools` / `GET /resources` (catalogs). Pure transport — same `tool-handlers.ts` / `resource-handlers.ts` MCP uses; no engine duplication. Errors → `{"error": "..."}` with HTTP status 400 / 401 / 403 / 404 / 500. SIGINT / SIGTERM → graceful drain. Every response carries `X-Codemap-Version: <semver>`. **CSRF + DNS-rebinding guard:** every request (including auth-exempt `/health`) is evaluated against `Sec-Fetch-Site` / `Origin` / `Host` when present — modern browsers send `Sec-Fetch-Site` and `Origin` on cross-origin fetches (header presence varies by request type, browser, and privacy settings), so the guard rejects browser-driven cross-origin requests like a malicious local webpage `fetch`-ing `http://127.0.0.1:7878/tool/save_baseline` to mutate `.codemap/index.db`. `Host` mismatch on a loopback bind blocks DNS rebinding (an attacker resolving `evil.com` to `127.0.0.1` post-load). Non-browser clients (curl, fetch from Node, MCP hosts, CI scripts) typically omit these headers and pass through. Implementation: `src/cli/cmd-serve.ts` (CLI shell) + `src/application/http-server.ts` (transport). See [`architecture.md` § HTTP wiring](./architecture.md#cli-usage).

### SARIF

[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) — Static Analysis Results Interchange Format. JSON envelope GitHub Code Scanning consumes natively. Codemap emits SARIF via `codemap query --format sarif` (or `format: "sarif"` on the MCP `query` / `query_recipe` tools). Rule id is `codemap.<recipe-id>` for `--recipe`; `codemap.adhoc` for ad-hoc SQL. Location columns auto-detected (`file_path` / `path` / `to_path` / `from_path` priority; `line_start` + optional `line_end` for region). Aggregate recipes (`index-summary`, `markers-by-kind`) emit `results: []` + a stderr warning. Incompatible with `--summary` / `--group-by` / baseline (different output shapes). Default `result.level` is `"note"`; per-recipe override deferred to v1.x. See [`architecture.md` § Output formatters](./architecture.md#cli-usage).

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

Write-Ahead Log mode. Set by `PRAGMA journal_mode = WAL` on every `openDb()`. Why `.codemap/index.db-wal` and `.codemap/index.db-shm` files exist alongside `.codemap/index.db`. Allows concurrent readers during writes.

### `WITHOUT ROWID`

SQLite per-table option that stores data directly in the primary key B-tree, eliminating a rowid lookup indirection. Used on `dependencies` (composite PK) and `meta` (single-column TEXT PK).

### worker pool

Parallel parse workers in `src/worker-pool.ts`. Bun `Worker` on Bun, Node `worker_threads` on Node. Used during full rebuild only — incremental and targeted indexing run sequentially.
