# Codemap — Architecture

See [documentation index](./README.md).

## Overview

A local SQLite database (`.codemap/index.db`) indexes the project tree and stores structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers) for SQL queries instead of repeated full-tree scans.

### Runtime and database

**`src/sqlite-db.ts`:** Node uses **`better-sqlite3`**; Bun uses **`bun:sqlite`**. Same schema everywhere. **`better-sqlite3`** allows **one SQL statement per `prepare()`**; **`bun:sqlite`** accepts **multiple statements** in one `run()`. On Node, **`runSql()`** splits multi-statement strings on **`;`** and runs each fragment. Do **not** put **`;`** inside **`--` line comments** in **`db.ts`** DDL strings (naive split would break). Details: [packaging.md § Node vs Bun](./packaging.md#node-vs-bun).

**`src/worker-pool.ts`:** Bun `Worker` or Node `worker_threads`. **`src/glob-sync.ts`:** **`tinyglobby`** on both Bun and Node for include patterns ([packaging § Node vs Bun](./packaging.md#node-vs-bun)). **`src/config.ts`:** loads **`<state-dir>/config.{ts,js,json}`** (JSON read path: **`Bun.file`** on Bun, **`readFile` + `JSON.parse`** on Node — [packaging.md § Node vs Bun](./packaging.md#node-vs-bun)), then validates with **Zod** (`codemapUserConfigSchema`). Details: [User config](#user-config). State directory resolved via **`src/application/state-dir.ts`** (`resolveStateDir`); precedence `--state-dir <path>` > `CODEMAP_STATE_DIR` > `.codemap/`.

**Shipped artifact:** **`dist/`** — `package.json` **`bin`** and **`exports`** both point at **`dist/index.mjs`** ([packaging.md](./packaging.md)); tsdown also emits **lazy CLI chunks** (`cmd-index`, `cmd-query`, `cmd-agents`, …) loaded via **`import()`** from **`src/cli/main.ts`**.

## Layering

| Layer                                        | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`cli/`** (`bootstrap`, `main`, `cmd-*`)    | Parses argv; **dynamic `import()`** loads only the command chunk (`cmd-index`, `cmd-query`, `cmd-agents`) so `--help` / `version` / `agents init` avoid the indexer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`api.ts`**                                 | Public programmatic surface: `createCodemap()`, `Codemap` (`query`, `index`), re-exports `runCodemapIndex` for advanced use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`application/`**                           | Pure transport-agnostic engines + handlers: `run-index.ts` / `index-engine.ts` (orchestration + indexing); `query-engine.ts` (`executeQuery` / `executeQueryBatch`); `audit-engine.ts` (`runAudit` + `resolveAuditBaselines` + `runAuditFromRef` + `makeWorktreeReindex`); `audit-worktree.ts` (sha-keyed cache + atomic populate); `context-engine.ts` (`buildContextEnvelope` + **`resolveContextBudget`**); `validate-engine.ts` (`computeValidateRows` + `toProjectRelative`); `show-engine.ts` (exact lookup + envelope builders); `search-query-parser.ts` + `search-engine.ts` + `show-search-mode.ts` (field-qualified `--query` search); `impact-engine.ts` (`findImpact` — graph blast-radius walker); `affected-engine.ts` (`resolveAffectedChangedPaths` + `executeAffectedTests` — `affected-tests` recipe composer); `trace-engine.ts` + `output-budget.ts` (**`resolveOutputBudget`** — adaptive snippet caps for trace/explore/node; explore row cap); `apply-engine.ts` (`applyDiffPayload` — substrate-shaped fix executor over the diff-json row contract); `coverage-engine.ts` (`upsertCoverageRows` core + `ingestIstanbul` / `ingestLcov` / `ingestV8` parsers; schema in [§ Schema → coverage](#schema)); `query-recipes.ts` + `recipes-loader.ts` (recipe registry); `output-formatters.ts` (SARIF + GH annotations + Mermaid `flowchart LR` with bounded-input contract); `watcher.ts` (chokidar-backed debounced reindex; pure helpers + injectable backend); `tool-handlers.ts` + `resource-handlers.ts` (transport-agnostic tool / resource handlers shared by MCP + HTTP); `mcp-server.ts` (MCP transport — stdio); `http-server.ts` (HTTP transport — `node:http`). Engines depend on `db.ts` / `runtime.ts`; **never** on `cli/`. |
| **`adapters/`**                              | `LanguageAdapter` registry; built-ins call `parser.ts` / `css-parser.ts` / `markers.ts` from `parse-worker-core`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`runtime.ts` / `config.ts` / `db.ts` / …** | Config, SQLite, resolver, workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

`index.ts` is the package entry: re-exports the public API and runs `cli/main` only when executed as the main module (Node/Bun `codemap` binary).

### Full rebuild (parallel)

```text
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
    └─ .codemap/index.db
```

### Incremental / targeted (sequential)

```text
  application/index-engine.ts (main thread)
    │
    ├─ git diff / --files
    │
    ├─ for each changed file:
    │     read → parse → resolve → INSERT
    │
    └─ .codemap/index.db
```

### Parser stack

```text
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

| File                                                                                                                                                          | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                                                                                                                    | Package entry — re-exports `api` / `config`, runs CLI when main                                                                                                                                                                                                                                                                                                                                                                  |
| `cli/`                                                                                                                                                        | CLI — bootstrap argv, lazy command modules, `query` / `validate` / `context` / `agents init` / index modes                                                                                                                                                                                                                                                                                                                       |
| `api.ts`                                                                                                                                                      | Programmatic API — `createCodemap`, `Codemap`, `runCodemapIndex`                                                                                                                                                                                                                                                                                                                                                                 |
| `application/`                                                                                                                                                | Pure transport-agnostic engines (`run-index`, `index-engine`, `query-engine`, `audit-engine`, `context-engine`, `validate-engine`, `show-engine`, `search-query-parser`, `search-engine`, `show-search-mode`, `impact-engine`, `affected-engine`, `trace-engine`, `output-budget`, `apply-engine`, `coverage-engine`, `query-recipes`, `recipes-loader`, `mcp-server`, `http-server`, `watcher`)                                 |
| `worker-pool.ts`                                                                                                                                              | Parallel parse workers (Bun / Node)                                                                                                                                                                                                                                                                                                                                                                                              |
| `db.ts`                                                                                                                                                       | SQLite adapter — schema DDL, typed CRUD, connection management                                                                                                                                                                                                                                                                                                                                                                   |
| `parser.ts`                                                                                                                                                   | TS/TSX/JS/JSX extraction via `oxc-parser` — symbols (with JSDoc + generics + return types), type members, imports, exports, components, markers                                                                                                                                                                                                                                                                                  |
| `css-parser.ts`                                                                                                                                               | CSS extraction via `lightningcss` — custom properties, classes, keyframes, `@theme` blocks                                                                                                                                                                                                                                                                                                                                       |
| `resolver.ts`                                                                                                                                                 | Import path resolution via `oxc-resolver` — respects `tsconfig` aliases, builds dependency graph                                                                                                                                                                                                                                                                                                                                 |
| `constants.ts`                                                                                                                                                | Shared constants — e.g. `LANG_MAP`                                                                                                                                                                                                                                                                                                                                                                                               |
| `glob-sync.ts`                                                                                                                                                | Include globs — **`tinyglobby`** on both runtimes ([packaging § Node vs Bun](./packaging.md#node-vs-bun))                                                                                                                                                                                                                                                                                                                        |
| `markers.ts`                                                                                                                                                  | Shared marker extraction (`TODO`/`FIXME`/`HACK`/`NOTE`) + `extractSuppressions` for opt-in `// codemap-ignore-{next-line,file} <recipe-id>` directives — used by all parsers                                                                                                                                                                                                                                                     |
| `parse-worker.ts`                                                                                                                                             | Worker thread entry point — reads, parses, and extracts file data in parallel                                                                                                                                                                                                                                                                                                                                                    |
| `adapters/`                                                                                                                                                   | `LanguageAdapter` types and built-in TS/CSS/text implementations                                                                                                                                                                                                                                                                                                                                                                 |
| `parsed-types.ts`                                                                                                                                             | Shared `ParsedFile` shape for workers and adapters                                                                                                                                                                                                                                                                                                                                                                               |
| `agents-init.ts` / `agents-init-interactive.ts` / `agents-init-mcp.ts` / `agents-init-mcp-registry.ts` / `agents-init-targets.ts` / `agents-template-path.ts` | `codemap agents init` — see [agents.md](./agents.md) (granular template + IDE writes, pointer upsert, **`--interactive`**, **`--mcp`** registry-driven JSON merge + verify-after-write, **`<state-dir>/.gitignore`** reconciler). **`agents-template-path.ts`** is the leaf bundled-template resolver (used by init + `application/agent-content` / `query-recipes` without import cycles).                                      |
| `codemap-invocation.ts` / `scripts/codemap-invocation.mjs`                                                                                                    | PM-aware codemap CLI spawn resolution (`resolveCodemapCliInvocation`, `buildCodemapMcpSpawn`); TS for **`agents init --mcp`**, `.mjs` mirror for Action **`detect-pm`** — keep in sync (`scripts/codemap-invocation-sync.test.mjs`).                                                                                                                                                                                             |
| `cli/cmd-skill.ts`                                                                                                                                            | `codemap skill` / `codemap rule` verbs — thin wrappers over `assembleAgentContent(kind)` that print the bundled markdown to stdout. See [agents.md § Live fetch surface](./agents.md#live-fetch-surface-cli--mcp--http).                                                                                                                                                                                                         |
| `application/agent-content.ts`                                                                                                                                | `assembleAgentContent(kind)`, `RENDERERS` map (`*.gen.md` dispatch), `renderRecipesSection` (live recipe catalog), `renderSchemaSection` (in-memory SQLite + `createTables()` DDL), `checkConsumerPointers` / `maybeWarnStalePointers`, `EXPECTED_POINTER_VERSION`. See [agents.md § Section assembler](./agents.md#section-assembler-and-genmd) and [§ Pointer protocol](./agents.md#pointer-protocol-and-staleness-detection). |
| `benchmark.ts` (+ `benchmark-default-scenarios.ts`, `benchmark-config.ts`, `benchmark-common.ts`)                                                             | SQL vs traditional timing; optional **`CODEMAP_BENCHMARK_CONFIG`** JSON — [benchmark.md § Custom scenarios](./benchmark.md#custom-scenarios-codemap_benchmark_config)                                                                                                                                                                                                                                                            |
| `config.ts`                                                                                                                                                   | `<state-dir>/config.{ts,js,json}` load path, **Zod** user schema (`codemapUserConfigSchema`), `resolveCodemapConfig`                                                                                                                                                                                                                                                                                                             |

## CLI usage

**Commands and flags** (index, query, **`codemap agents init`**, **`--root`**, **`--config`**, environment): [../README.md § CLI](../README.md#cli) — **do not duplicate** flag lists here; this section only adds implementation notes. From this repository: **`bun run dev`** or **`bun src/index.ts`** (same flags).

**Query wiring:** Ad-hoc and recipe CLI SQL runs through **`printQueryResult`** in **`src/application/index-engine.ts`**, which sets **`PRAGMA query_only = 1`** before execute (parity with **`queryRows`** / **`executeQuery`**). **`src/cli/cmd-query.ts`** (argv, `--recipe` / `-r` alias, **`--summary`**, **`--changed-since`**, **`--group-by`**, **`--save-baseline`** / **`--baseline`** / **`--baselines`** / **`--drop-baseline`**, **`--ci`** (aliases `--format sarif` + non-zero exit on findings + quiet)), **`src/application/query-recipes.ts`** (**`QUERY_RECIPES`** — recipe registry proxy over bundled + project-local recipes; optional **`actions: RecipeAction[]`** per recipe), **`src/cli/main.ts`** (**`--recipes-json`** / **`--print-sql`** exit before config/DB). With **`--json`**, errors use **`{"error":"…"}`** on stdout for SQL failures, DB open, and bootstrap (same shape); **`runQueryCmd`** sets **`process.exitCode`** instead of **`process.exit`**. Friendlier "no `.codemap/index.db`" — `no such table: <X>` and `no such column: <X>` errors are rewritten in **`enrichQueryError`** to point at `codemap` / `codemap --full`. **`--summary`** filters output only — the SQL still executes against the index; output collapses to `{"count": N}` (with `--json`) or `count: N`. **`--changed-since <ref>`** post-filters result rows by `path` / `file_path` / `from_path` / `to_path` / `resolved_path` against `git diff --name-only <ref>...HEAD ∪ git status --porcelain` (helper: **`src/git-changed.ts`** — `getFilesChangedSince`, `filterRowsByChangedFiles`, `PATH_COLUMNS`); rows with no recognised path column pass through. **`--group-by <mode>`** (`owner` | `directory` | `package`) routes through **`runGroupedQuery`** in `cmd-query.ts` and emits `{"group_by": "<mode>", "groups": [{key, count, rows}]}` (or `[{key, count}]` with `--summary`); helpers in **`src/group-by.ts`** (`groupRowsBy`, `firstDirectory`, `loadCodeowners`, `discoverWorkspaceRoots`, `makePackageBucketizer`, `codeownersGlobToRegex`). CODEOWNERS lookup is last-match-wins (GitHub semantics); workspace discovery reads `package.json` `workspaces` and `pnpm-workspace.yaml` `packages:`. **`--save-baseline[=<name>]`** snapshots the result to the **`query_baselines`** table inside `<state-dir>/index.db` (default `.codemap/index.db`; no parallel JSON files; survives `--full` / SCHEMA bumps because the table is intentionally absent from `dropAll()`); name defaults to `--recipe` id, ad-hoc SQL needs an explicit name. **`--baseline[=<name>]`** replays the SQL, fetches the saved row set, and emits `{baseline:{...}, current_row_count, added: [...], removed: [...]}` (or `{baseline:{...}, current_row_count, added: N, removed: N}` with `--summary`); identity is per-row multiset equality (canonical `JSON.stringify` keyed frequency map — duplicate rows are tracked, not collapsed). No fuzzy "changed" category in v1. **`--group-by` is mutually exclusive** with both `--save-baseline` and `--baseline` (different output shapes). **`--baselines`** (read-only list) and **`--drop-baseline <name>`** complete the surface; helpers in **`src/db.ts`** (`upsertQueryBaseline`, `getQueryBaseline`, `listQueryBaselines`, `deleteQueryBaseline`). **Per-row recipe `actions`** are appended only when the user runs **`--recipe <id>`** with **`--json`** AND the recipe defines an `actions` template — programmatic `cm.query(sql)` and ad-hoc CLI SQL never carry actions; under `--baseline`, actions attach to `added` rows only (the rows the agent should act on). The **`components-by-hooks`** recipe ranks by hook count with a **comma-based tally** on **`hooks_used`** (no SQLite JSON1). Shipped **`templates/agents/`** documents **`codemap query --json`** as the primary agent example ([README § CLI](../README.md#cli)).

**Output formatters:** **`src/application/output-formatters.ts`** — pure transport-agnostic; **`formatSarif`** emits SARIF 2.1.0 (auto-detected location columns: `file_path` / `path` / `to_path` / `from_path` priority + optional `line_start` / `line_end` region; `rule.id = codemap.<recipe-id>` for `--recipe`, `codemap.adhoc` for ad-hoc SQL; aggregate recipes without locations → `results: []` + stderr warning); **`formatAuditSarif`** emits the audit-shaped variant — one rule per delta key (`codemap.audit.<key>-added`), one result per `added` row at severity `warning`; `removed` rows excluded (SARIF surfaces findings, not cleanups); location-only rows fall back to `"new <key>: <uri>"` messages; **`formatAnnotations`** emits `::notice file=…,line=…::msg` GitHub Actions workflow commands (one line per locatable row; messages collapsed to a single line because the GH parser stops at the first newline); **`formatMermaid`** emits a `flowchart LR` from `{from, to, label?, kind?}` rows with a hard `MERMAID_MAX_EDGES = 50` ceiling — unbounded inputs reject with a scope-suggestion error naming the recipe + count + `LIMIT` / `--via` / `WHERE` knobs (auto-truncation deliberately out of scope; would be a verdict masquerading as output mode); **`formatDiff`** emits read-only unified diff text from `{file_path, line_start, before_pattern, after_pattern}` rows; **`formatDiffJson`** emits structured `{files, warnings, summary}` hunks for agents. Diff formatters read source files at format time and surface `stale` / `missing` flags when the indexed line no longer matches. Wired into both **`src/cli/cmd-query.ts`** (`--format <text|json|sarif|annotations|mermaid|diff|diff-json>`; `--format` overrides `--json`; formatted outputs reject `--summary` / `--group-by` / baseline at parse time) and the MCP **`query`** / **`query_recipe`** tools (`format: "sarif" | "annotations" | "mermaid" | "diff" | "diff-json"` with the same incompatibility guard). Per-recipe `sarifLevel` / `sarifMessage` / `sarifRuleId` overrides via frontmatter on `<id>.md` deferred to v1.x.

**Validate wiring:** **`src/cli/cmd-validate.ts`** (argv + render) + **`src/application/validate-engine.ts`** (engine — **`computeValidateRows`** + **`toProjectRelative`**). `computeValidateRows` is a pure function over `(db, projectRoot, paths)` returning `{path, status}` rows where `status ∈ stale | missing | unindexed`. CLI wraps it with read-once-and-print + exits **1** on any drift (git-status semantics). Path normalization: **`toProjectRelative`** converts CLI input to POSIX-style relative keys matching the `files.path` storage format (Windows backslash → forward slash); same convention as `lint-staged.config.js`. Also reused by `cmd-show.ts` / `cmd-snippet.ts` and the MCP show/snippet handlers — single canonical implementation.

**Audit wiring:** **`src/cli/cmd-audit.ts`** (argv, `--baseline <prefix>` auto-resolve sugar, `--<key>-baseline <name>` per-delta explicit overrides, `--base <ref>` git-ref baseline, `--format <text|json|sarif>`, `--json` (= `--format json` shortcut), `--ci` (aliases `--format sarif` + non-zero exit on additions), `--summary`, `--no-index`) + **`src/application/audit-engine.ts`** (delta registry + diff). SARIF emit goes through `output-formatters.ts`'s `formatAuditSarif` — one rule per delta key (`codemap.audit.<key>-added`), one result per `added` row at severity `warning`. Mirrors the `cmd-audit.ts ↔ audit-engine.ts` seam — CLI parses + dispatches; engine does the diff. **`runAudit({db, baselines})`** iterates the per-delta baseline map; deltas absent from the map don't run. Each entry in **`V1_DELTAS`** pins a canonical SQL projection (`files`: `SELECT path FROM files`; `dependencies`: `SELECT from_path, to_path FROM dependencies`; `deprecated`: `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%'`) plus a `requiredColumns` list. **`computeDelta`** validates baseline column-set membership, projects baseline rows down to the canonical column subset (extras dropped — schema-drift-resilient), runs the canonical SQL via the caller's DB connection, and set-diffs via the existing **`src/diff-rows.ts`** multiset helper (shared with `query --baseline`). Each emitted delta carries its own **`base`** metadata so mixed-baseline audits (e.g. `--baseline base --dependencies-baseline override`) are first-class. **`runAuditCmd`** runs an auto-incremental-index prelude (`runCodemapIndex({mode: "incremental", quiet: true})`) before the diff so `head` reflects the current source — `--no-index` opts out for frozen-DB CI scenarios. **`--ci`** provides the shipped CI exit-code path by setting `process.exitCode = 1` when additions exist; verdict thresholds remain deferred. **`resolveAuditBaselines({db, baselinePrefix, perDelta})`** composes the baseline map: auto-resolves `<prefix>-<delta-key>` for slots that exist (silently absent otherwise) and lets per-delta flags override individual slots. **`--base <ref>` (shipped):** **`runAuditFromRef({db, ref, perDeltaOverrides, projectRoot, reindex})`** materialises the ref via **`application/audit-worktree.ts`** — `git rev-parse --verify "<ref>^{commit}"` → resolved sha → cache lookup at `<projectRoot>/.codemap/audit-cache/<sha>/`. Cache miss: per-pid temp dir (`.tmp.<sha>.<pid>.<ts>`) receives `git archive --format=tar <sha>` piped into `tar -xf -`; the injected `reindex` callback (`makeWorktreeReindex` in production — re-inits runtime singletons against the extracted tree, runs `runCodemapIndex({mode: "full"})`, restores) writes `.codemap/index.db` inside, then POSIX `rename` claims the final `<sha>/` slot. **Atomic populate** — concurrent processes resolving the same sha race-safely without lock files (loser's rename fails with EEXIST → falls through to cache hit). Eviction: hardcoded LRU 5 entries / 500 MiB; `rm -rf` removes each victim; orphan `.tmp.*` dirs older than 10 min get swept too. Per-delta `base` metadata gains a discriminator: existing baseline-source remains `{source: "baseline", name, sha, indexed_at}`; new ref-source is `{source: "ref", ref, sha, indexed_at}`. `--base` is mutually exclusive with `--baseline <prefix>` (parser + handler both guard); composes orthogonally with per-delta `--<key>-baseline name` overrides. Hard error on non-git projects (`existsSync(<root>/.git)` check before any spawn). All git spawns in `audit-worktree.ts` strip inherited `GIT_*` env vars so a containing git operation (e.g. running codemap inside a husky hook) doesn't route archive calls at the wrong index.

**PR-comment wiring:** **`src/cli/cmd-pr-comment.ts`** (argv — `<input-file>` (or `-` for stdin) + `--shape audit|sarif` + `--json`) + **`src/application/pr-comment-engine.ts`** (engine — `renderAuditComment` / `renderSarifComment` / `detectCommentInputShape`). Renders an audit-JSON envelope or SARIF doc as a markdown PR-summary comment; designed for surfaces SARIF→Code-Scanning doesn't cover (private repos without GHAS, aggregate audit deltas without `file:line` anchors, bot-context seeding). Output: bare markdown by default; `--json` envelope `{markdown, findings_count, kind}` for action.yml steps. Audit-mode groups by delta with `<details>` sections (added + removed); SARIF-mode groups by `ruleId`. Lists >50 entries collapse to `… and N more`. v1.0 ships the (b) summary-comment shape; (c) inline-review comments deferred per Q4 of [`plans/github-marketplace-action.md`](./plans/github-marketplace-action.md).

**Context wiring:** **`src/cli/cmd-context.ts`** (argv + render) + **`src/application/context-engine.ts`** (engine — **`buildContextEnvelope`**, **`classifyIntent`**, **`composeStartHere`**, **`resolveContextBudget`**, `ContextEnvelope` type). `buildContextEnvelope` composes the JSON envelope from existing recipes (legacy **`hubs`** at the bundled `fan-in` recipe default limit; budget-capped **`start_here.hub_leaders`** via **`resolveContextBudget(file_count)`**), intent-scoped `sample_markers`, `QUERY_RECIPES` catalog, **`start_here`** (inline `index-summary`, intent-ranked `query_recipe` cards, hub leaders with exported-symbol signatures — optional one-line **`include_snippets`** on MCP/HTTP, path-contained disk reads with `stale`/`missing` flags), and **`index_freshness`** via **`src/application/index-freshness.ts`**. Debug `--for` / MCP `intent` biases markers toward FIXME/TODO kinds; whitespace-only intent is treated as no intent on all transports. **`classifyIntent`** maps free text to `refactor | debug | test | feature | explore | other`; **`start_here.classified_as`** is `"default"` when no intent is supplied. Hub-leader **`include_snippets`** one-liners share the adaptive **`signature_max_chars`** cap. **`--compact`** drops `hubs`, `sample_markers`, and `start_here` and emits minified JSON (non-compact pretty-prints with 2-space indent). Whitespace-only `--for` values are rejected at CLI parse time. MCP/HTTP **`include_snippets`** is a no-op when **`compact: true`**. Product-shape constraint: [No split-brain incremental index](./roadmap.md#floors-v1-product-shape).

**Impact wiring:** **`src/cli/cmd-impact.ts`** (argv — `<target>` + `--direction up|down|both` + `--depth N` + `--via dependencies|calls|imports|all` + `--limit N` + `--summary` + `--json`; bootstrap absorbs `--root`/`--config`) + **`src/application/impact-engine.ts`** (engine — `findImpact({db, target, direction?, via?, depth?, limit?})`). Pure transport-agnostic walker over the calls + dependencies + imports graphs; CLI / MCP / HTTP all dispatch the same engine function via `tool-handlers.ts`'s `handleImpact`. Target auto-resolves: contains `/` or matches `files.path` → file target; otherwise symbol (case-sensitive). Walks compatible backends per resolved kind: **symbol** → `calls` (callers / callees by `caller_name` / `callee_name`); **file** → `dependencies` (`from_path` / `to_path`) + `imports` (`file_path` / `resolved_path`, `IS NOT NULL` filter). `--via <b>` overrides; mismatched explicit choices land in `skipped_backends` (no error — agents see why their backend selection yielded fewer rows than expected). One `WITH RECURSIVE` per (direction, backend) combo with cycle detection via path-string `instr` check (SQLite has no native cycle predicate); JS-side merge + dedup by `(direction, kind, name?, file_path)` keeping the shallowest depth. `--depth 0` uses an unbounded sentinel (`UNBOUNDED_DEPTH_SENTINEL = 1_000_000`); cycle detection + `LIMIT` keep cyclic graphs cheap regardless. Termination reason classification: `limit` (truncated) > `depth` (any node sat at the cap) > `exhausted`. Result envelope: `{target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by}, skipped_backends?}`. `--summary` blanks `matches` (transport bandwidth saver) but preserves `summary.nodes` so CI gates (`jq '.summary.nodes'`) still see the count. SARIF / annotations not supported (graph traversal, not findings — the parser accepts the flag combos but the engine only emits JSON).

**Affected wiring:** **`src/cli/cmd-affected.ts`** (argv — positional paths / `--stdin` / `--changed-since <ref>` / `--params test_glob|max_depth` + `--json`; bootstrap absorbs `--root`/`--config`) + **`src/application/affected-engine.ts`** (engine — `resolveAffectedChangedPaths` + `executeAffectedTests`; pure recipe composer over bundled `affected-tests` SQL). CLI / MCP / HTTP dispatch the same engine via `tool-handlers.ts`'s `handleAffected` (MCP/HTTP) and `runAffectedCmd` (CLI). Path precedence: explicit paths (CLI positional / MCP `paths` array) → CLI `--stdin` → git vs `changed_since` / `HEAD` (`paths: []` on MCP/HTTP skips git). Result envelope: JSON array of `{test_path, impact_depth, actions?}` — file paths only; CI composes the runner command. **`tryRecordRecipeRun("affected-tests")`** lives at the orchestration layer (`handleAffected` + `runAffectedCmd`), not in the engine — same boundary discipline as `query_recipe` (see [§ `recipe_recency`](#recipe_recency--per-recipe-last-run--run-count-user-data-strict-without-rowid)). Recency records only when at least one changed path was resolved and the recipe SQL ran (empty path sets return `[]` without a recency write).

**Trace / explore / node wiring:** **`src/cli/cmd-composers.ts`** (argv — `trace` / `explore` / `node`; bootstrap absorbs `--root`/`--config`) + **`src/application/trace-engine.ts`** (engine — `executeCallPath` / `executeSymbolNeighborhood` recipe composers + `composeTraceResult` / `composeExploreResult` / `composeNodeResult` snippet batching) + **`src/application/output-budget.ts`** (`applySourceCharBudget`, **`resolveOutputBudget(file_count)`** — adaptive snippet char caps 15k / 10k / 6k when MCP/HTTP `budget_chars` omitted on trace/explore/node; explore also applies adaptive row limits 500 / 250 / 125 internally with no transport override). MCP/HTTP dispatch via `tool-handlers.ts`'s `handleTrace` / `handleExplore` / `handleNode`; CLI dispatches the same handlers via `cmd-composers.ts`. **`trace`** → `call-path` recipe + disk snippets per hop (cross-file symbol lookup); snippet budget only (`truncation.snippets`; `snippets_skipped_reason` on dependency hops). **`explore`** → deduped `symbol-neighborhood` per `names[]` entry, adaptive row cap (500 / 250 / 125), budget-capped snippets (`truncation.rows` / `truncation.snippets`). **`node`** → `show` center + scoped depth-1 neighborhood (filters to center instance when unique) + optional center+neighbor snippets (`truncated` only when `include_snippets: true`). Explicit MCP/HTTP **`budget_chars`** overrides adaptive snippet defaults. Recipe twins remain the Moat A fallback (`query_recipe call-path`, `query_recipe symbol-neighborhood`). **`tryRecordRecipeRun`** at orchestration only (`call-path` on trace success; `symbol-neighborhood` on explore/node success).

**Query batch / file / schema / symbols wiring:** **`src/cli/cmd-query-batch.ts`** (argv — `query batch [--stdin | --file]`; JSON body validated with `queryBatchArgsSchema`) + **`handleQueryBatch`** in **`tool-handlers.ts`**. **`src/cli/cmd-resource.ts`** (argv — `file <path>` / `schema` / `symbols <name>`) + **`buildFileRollup` / `buildSchemaCatalog` / `buildSymbolLookup`** exported from **`resource-handlers.ts`** (same payloads as `codemap://files/{path}` / `codemap://schema` / `codemap://symbols/{name}`).

**Apply wiring:** **`src/cli/cmd-apply.ts`** (argv — `<recipe-id>` + `--params` + `--dry-run` + `--yes` + `--json`; bootstrap absorbs `--root`/`--config`) + **`src/application/apply-engine.ts`** (engine — `applyDiffPayload({rows, projectRoot, dryRun})`). Pure transport-agnostic substrate-shaped fix executor: consumes the existing `--format diff-json` row contract from any recipe (`{file_path, line_start, before_pattern, after_pattern}`), validates each row against current disk, and either previews (dry-run) or writes (apply). CLI / MCP / HTTP all dispatch the same engine via `tool-handlers.ts`'s `handleApply`. **Phase 1** (always) resolves the project root via `path.resolve(projectRoot)` once, then for each row: rejects absolute `file_path` inputs and any candidate whose `path.resolve(resolvedRoot, file_path)` lands outside `resolvedRoot` (conflict `path escapes project root` — guards CLI + MCP + HTTP write paths against `../escape.ts`-style traversal); rejects duplicate `(file_path, line_start)` tuples (conflict `duplicate edit on same line` — without this, two phase-1-passing rows targeting the same line would split the run mid-phase-2 because the first replace invalidates the second's substring assertion, leaving Q2 (c) cross-file partial state). Reads each file at most once into `sourceCache`, splits on `/\r?\n/` for conflict reporting, checks `actual.includes(before_pattern)` (substring match — mirrors `buildDiffJson`'s contract; `rename-preview` emits `before_pattern = old_name` as the bare identifier, so whole-line exact match would conflict every time). Conflicts collect five reasons (`file missing` / `line out of range` / `line content drifted` / `path escapes project root` / `duplicate edit on same line`) — Q3 scan-and-collect, not fail-fast. **Phase 2** (gated on `!dryRun && conflicts.length === 0`) re-splits the cached source on raw `"\n"` (preserves CRLF as trailing `\r` per line; rejoining with `"\n"` round-trips losslessly), applies each file's edits in descending line order via `actual.replace(before, after)` with `$`-pre-escape (`replace(/\$/g, "$$$$")` — matches `buildDiffJson`'s GetSubstitution defence so identifiers like `$inject` round-trip safely), writes to a sibling temp path (`<file>.codemap-apply-<rand>.tmp`), then `renameSync` into place — POSIX-atomic per file; concurrent readers see either pre-rename or post-rename content, never a torn write. **Q2 (c) all-or-nothing (semantic)**: any phase-1 conflict aborts phase 2 entirely before any file is touched. Phase-2 I/O failures (`writeFileSync` / `renameSync`) are NOT transactional across files — per-file atomicity holds (temp + rename), but a crash on file N leaves files `1..N-1` already renamed with no rollback; cross-file rollback would require pre-write backups + restore-on-throw and is deferred to a future PR. **Q6 gate**: TTY no `--yes` → phase-1 preview + `Proceed? [y/N]` prompt on stderr (default-N, `node:readline/promises`); TTY `--yes` → no prompt; non-TTY (CI / agents / MCP) without `--yes`/`--dry-run` rejected with stderr message. `--dry-run` + `--yes` mutually exclusive (parse-time error). MCP/HTTP transports (`handleApply`) require `yes: true` for the write path — there's no prompt to fall back on; `dry_run + yes` rejected as mutually exclusive. Result envelope (Q5; identical across modes): `{mode: 'dry-run'|'apply', applied: bool, files: [{file_path, rows_applied, warnings?}], conflicts: [{file_path, line_start, before_pattern, actual_at_line, reason}], summary: {files, files_modified, rows, rows_applied, conflicts, files_with_conflicts}}`. `applied: true` only when `mode === 'apply'` AND zero conflicts AND at least one row applied. Q7 idempotency: re-running on already-applied code reports a `line content drifted` conflict with `actual_at_line` showing the post-rename content; the user reads it and re-runs `codemap` to refresh the index → next run produces 0 rows (recipe finds nothing to rename) → vacuous clean apply. **Same-line ambiguity caveat (documented limitation):** `actual.replace(before_pattern, after_pattern)` rewrites only the **first** occurrence on the line. When `before_pattern` appears twice (e.g. `const foo = foo();` with `before = "foo"`) only the leftmost is replaced; the engine still reports `applied: true`. This mirrors `buildDiffJson`'s formatter contract verbatim — recipe authors who hit it normalise their SQL to emit a more specific pattern, or accept it (the formatter's `--format diff` preview shows the same shape). Promotion path: tighten phase-1 to conflict on ambiguity in a future PR if real users complain, but only alongside the formatter so preview and execution stay in lockstep. SARIF / annotations not supported (write action, not findings). TOCTOU: phase-1 reads through `sourceCache`; phase-2 transforms the cached source and writes — the gap between read and rename is a deliberate v1 simplification (apply isn't adversarial). Per Q10, only `cli/cmd-apply.ts` + `application/tool-handlers.ts` (+ the test files) may import `apply-engine.ts` for production execution — re-runnable forbidden-edge query at [§ Boundary verification — apply write path](#boundary-verification--apply-write-path).

**Show / snippet wiring:** **`src/cli/show-snippet-args.ts`** (shared argv parser) + **`src/cli/show-snippet-render.ts`** (shared terminal/JSON error helpers) + **`src/cli/cmd-show.ts`** + **`src/cli/cmd-snippet.ts`** — sibling CLI verbs sharing the same parser shape (`<name>` or **`--query '<field:value …>'`** + **`--with-fts`** + `--kind` + `--in <path>` + `--json`; show adds **`--print-sql`**) and the pure engines **`src/application/show-engine.ts`** (exact lookup + envelope builders), **`src/application/search-query-parser.ts`** + **`src/application/search-engine.ts`** (field-qualified search → parameterized SQL on `symbols`, optional `source_fts` join), and **`src/application/show-search-mode.ts`** (shared parse/normalize + FTS resolution + **`executeShowLookup`** + **`formatShowSearchSqlForQuery`** for CLI/MCP/HTTP). Exact lookup: `findSymbolsByName({db, name, kind?, inPath?})`. Query lookup: `searchSymbols({db, parsed, withFts?})`. Snippet FS read: `readSymbolSource({match, projectRoot, indexedContentHash?})` + `getIndexedContentHash(db, filePath)`. **`buildShowResult`** + **`buildSnippetResult`** envelope builders — same engines the MCP show/snippet tools call. Both verbs return the same `{matches, disambiguation?, warning?}` envelope — single match → `{matches: [{...}]}`; multi-match adds `{n, by_kind, files, hint}`; optional **`warning`** when FTS was requested but `source_fts` is empty. Snippet matches add `source` / `stale` / `missing` fields (additive — no shape divergence). **`--in <path>`** and **`path:`** inside **`--query`** normalize through `toProjectRelative(projectRoot, p)` (from **`src/application/validate-engine.ts`**). Stale-file behavior on `snippet`: `hashContent` (from **`src/hash.ts`**) compares on-disk content against `files.content_hash`; mismatch sets `stale: true` but source IS still returned. MCP tools `show` and `snippet` register parallel to the CLI surface (see [§ MCP wiring](#cli-usage)).

**Recipes wiring:** **`src/application/recipes-loader.ts`** (pure transport-agnostic loader) + **`src/application/query-recipes.ts`** (cache + public API — `getQueryRecipeSql` / `getQueryRecipeActions` / `getQueryRecipeParams` / `listQueryRecipeIds` / `listQueryRecipeCatalog` / `getQueryRecipeCatalogEntry`, shared by CLI + MCP). Recipes live as file pairs: **`<id>.sql`** + optional **`<id>.md`**. The loader reads `templates/recipes/` (bundled, ships in npm package next to `templates/agents/`) and `<state-dir>/recipes/` (project-local — default `.codemap/recipes/`; honors `--state-dir` / `CODEMAP_STATE_DIR`; root-only resolution per the registry plan, no walk-up). Project recipes win on id collision; entries that override a bundled id carry **`shadows: true`** in the catalog so agents reading `codemap://recipes` at session start see when a recipe behaves differently from the documented bundled version. Per-row **`actions`** templates and recipe **`params`** declarations live in YAML frontmatter on each `<id>.md` — uniform shape across bundled + project. Param types are `string | number | boolean`; CLI passes values via repeatable `--params key=value[,key=value]`, MCP / HTTP pass nested `params: {key: value}` to `query_recipe`. Validation runs before SQL binding; missing / unknown / malformed params return the same `{error}` envelope as query failures. Hand-rolled YAML parser is scoped to block-list `actions:` and `params:` only (no `js-yaml` dep). Load-time validation rejects empty SQL and DML / DDL keywords (`INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `ALTER` / `ATTACH` / `DETACH` / `REPLACE` / `TRUNCATE` / `VACUUM` / `PRAGMA`) with recipe-aware error messages — defence in depth alongside the runtime `PRAGMA query_only=1` backstop in `query-engine.ts` (PR #35). `<state-dir>/index.db` is gitignored; `<state-dir>/recipes/` is NOT (verified via `git check-ignore`) — recipes are git-tracked source code authored for human review.

**Tool / resource handlers (transport-agnostic):** **`src/application/tool-handlers.ts`** + **`src/application/resource-handlers.ts`** — pure functions that take the args object an MCP tool / resource URI accepts and return a discriminated **`ToolResult`** (`{ok: true, format: 'json'|'sarif'|'annotations'|'mermaid'|'diff'|'diff-json', payload}` / `{ok: false, error}`) or a **`ResourcePayload`** (`{mimeType, text}`). MCP and HTTP both wrap the same handlers — MCP translates to `{content: [{type: "text", text}]}`, HTTP translates to `(status, body)` with the right `Content-Type`. Engine layer untouched; transport changes don't ripple into the SQL.

**MCP wiring:** **`src/cli/cmd-mcp.ts`** (argv — `--watch` / `--no-watch` / `--debounce` + `--help`; bootstrap absorbs `--root`/`--config`) + **`src/application/mcp-server.ts`** (transport — tool / resource registry, SDK glue). Mirrors the `cmd-audit.ts ↔ audit-engine.ts` seam — CLI parses + lifecycle; engine owns the SDK. **`runMcpServer`** bootstraps codemap once at server boot (config + resolver + DB access become module-level state), instantiates `McpServer` from **`@modelcontextprotocol/sdk`**, attaches a **`StdioServerTransport`**, and resolves on client disconnect via **`src/application/session-lifecycle.ts`** (`createStdioDisconnectMonitor` — stdin EOF, stdout EPIPE, parent-PID poll — plus SDK `transport.onclose` and SIGINT/SIGTERM). With `--watch`, **`createManagedWatchSession`** holds one client for the stdio session and **`forceStop`** drains the watcher on exit. Tool handlers reuse the existing engine entry-points: **`query`** + **`query_recipe`** call **`executeQuery`** in **`src/application/query-engine.ts`** (a pure transport-agnostic engine extracted from `printQueryResult`'s JSON branch — same `[...rows]` / `{count}` / `{group_by, groups}` envelope `--json` would print); **`query_batch`** loops per statement via **`handleQueryBatch`** → **`executeQuery`** (batch-wide defaults + per-item overrides; items are `string | {sql, summary?, changed_since?, group_by?}`); **`audit`** runs `resolveAuditBaselines` + `runAudit` from PR #33 unchanged; **`context`** / **`validate`** call `buildContextEnvelope` / `computeValidateRows` from **`src/application/context-engine.ts`** + **`src/application/validate-engine.ts`** (lifted out of `src/cli/cmd-*.ts` in PR #41 — see § Tool / resource handlers above). **`save_baseline`** is one polymorphic tool (`{name, sql? | recipe?}`) with a runtime exclusivity check — mirrors the CLI's single `--save-baseline=<name>` verb. **Tool naming**: snake_case throughout — Codemap convention matching the patterns in MCP spec examples and reference servers (GitHub MCP, Cursor built-ins); the spec itself doesn't mandate it. CLI stays kebab — translation lives at the MCP-arg layer. **Resources** split by freshness contract: `codemap://schema`, `codemap://skill`, `codemap://rule`, and `codemap://mcp-instructions` use **lazy memoisation** — first `read_resource` populates a per-server-instance cache; constant for the server-process lifetime so eager-vs-lazy produce identical observable behavior. `codemap://recipes`, `codemap://recipes/{id}`, `codemap://files/{+path}`, and `codemap://symbols/{name}` are **live read-per-call** (no cache) so inline recency fields and index mutations under `--watch` don't freeze at first-read. `codemap://schema` queries `sqlite_schema` live (on first read, then cached); `codemap://skill` / `codemap://rule` / `codemap://mcp-instructions` call `assembleAgentContent(kind)` from `application/agent-content.ts`, which concatenates section files under `templates/agent-content/<kind>/` and dispatches `*.gen.md` files through `RENDERERS` (live recipe catalog, live `createTables()` DDL) — see [agents.md § Section assembler](./agents.md#section-assembler-and-genmd). Output shape: each tool returns the JSON payload its CLI counterpart would print (`query batch`, `trace`, `explore`, `node`, `file`, `schema`, `context --include-snippets`); MCP wraps via `content: [{type: "text", text: JSON.stringify(payload)}]`. `--changed-since` git lookups are memoised per `(root, ref)` pair across batch items so a `query_batch` of N items sharing the same ref does one git invocation, not N. Per-statement errors in `query_batch` are isolated — failed statements return `{error}` in their slot while siblings still execute.

**HTTP wiring:** **`src/cli/cmd-serve.ts`** (argv — `--host` / `--port` / `--token`; bootstrap absorbs `--root`/`--config`) + **`src/application/http-server.ts`** (transport — bare `node:http`; routes `POST /tool/{name}` to `tool-handlers`, `GET /resources/{encoded-uri}` to `resource-handlers`, plus `GET /health` / `GET /tools` / `GET /resources`). Default bind **`127.0.0.1:7878`** (loopback only — refuse `0.0.0.0` unless explicitly opted in via `--host 0.0.0.0`). Optional **`--token <secret>`** requires `Authorization: Bearer <secret>` on every request; `GET /health` is auth-exempt so liveness probes work without leaking the token. **CSRF + DNS-rebinding guard** (`csrfCheck`) runs before every route — rejects `Sec-Fetch-Site: cross-site` / `same-site` (modern-browser CSRF), any present `Origin` header (including the opaque string `null`; older-browser CSRF fallback), and `Host` header mismatch on loopback bind (DNS rebinding). Non-browser clients (curl, fetch from Node, MCP hosts, CI scripts) don't send those headers and pass through. The guard runs even on `/health` so a malicious local webpage can't probe for liveness. Output shape: HTTP returns each tool's native JSON payload directly (NOT MCP's `{content: [...]}` wrapper — HTTP doesn't need that transport artifact); `query` / `query_recipe` match `codemap query --json` row arrays (or `{count}` / `{group_by,groups}` when `summary` / `group_by` is set — baseline save/compare is separate tools, not MCP/HTTP `query`); other tools match their CLI `--json` envelopes; `format: "sarif"` payloads ship as `application/sarif+json`, `format: "annotations"` / `"mermaid"` / `"diff"` as `text/plain; charset=utf-8`, `format: "diff-json"` as `application/json; charset=utf-8`, JSON otherwise. Per-request DB lifecycle: open / `PRAGMA query_only = 1` / close per call (SQLite reader concurrency); 1 MiB request-body cap rejects trivial DoS. SIGINT / SIGTERM → graceful drain via `server.close()`. Every response carries **`X-Codemap-Version: <semver>`** so consumers can pin / detect upgrades.

**Watch wiring:** **`src/cli/cmd-watch.ts`** (argv — `--debounce <ms>` / `--quiet`; bootstrap absorbs `--root`/`--config`) + **`src/application/watcher.ts`** (engine — pure debouncer + glob filter + injectable backend; production wires [chokidar v5](https://github.com/paulmillr/chokidar) selected via the 6-watcher audit in PR #46 — pure JS, runs identically on Bun + Node, ~30M repos use it). On every change/add/unlink event chokidar emits, the engine filters via `shouldIndexPath` (same indexed extensions as the indexer + project-local recipes; skips `node_modules` / `.git` / `dist`), debounces with a sliding window (default 250 ms), then calls `createReindexOnChange` which opens a DB, runs `runCodemapIndex({mode: 'files', files: [...changed]})`, closes the DB, and logs `reindex N file(s) in Mms` to stderr unless `--quiet`. SIGINT / SIGTERM drains pending edits via `flushNow()` before the watcher closes. **Default-ON for `mcp` / `serve` since 2026-05:** both transports embed the watcher via **`createManagedWatchSession`** in **`session-lifecycle.ts`** — MCP holds one client for the stdio session; HTTP acquires per request (excluding `/health`) and stops the watcher after the last client plus a 5s release grace (not an MCP idle shutdown). Opt out with `--no-watch`, `CODEMAP_WATCH=0`, or `CODEMAP_NO_WATCH=1`. **`src/application/watch-policy.ts`** disables the watcher on WSL2 Windows drive mounts (`/mnt/*`) unless `CODEMAP_FORCE_WATCH=1`; stderr points at `codemap agents init --git-hooks` for git-triggered freshness. Standalone `codemap watch` runs the watcher decoupled from a transport for users wiring it next to a separate MCP / HTTP process. **Audit prelude optimization:** module-level `watchActive` flag; `handleAudit` skips its incremental-index prelude when active (and marks the close as readonly to avoid a wasted checkpoint). Explicit `no_index: false` still forces the prelude.

**Session lifecycle wiring:** **`src/application/session-lifecycle.ts`** — transport-specific start/stop rules for long-running `mcp` / `serve` processes (one-shot CLI unchanged). **`createStdioDisconnectMonitor`** (MCP only) exits the process when the agent host is actually gone: stdin EOF, stdout `EPIPE`, boot parent PID no longer alive (2s poll), or SIGINT/SIGTERM. The MCP SDK's stdio `transport.onclose` alone is insufficient — it fires only after an explicit `transport.close()`, not when the parent crashes without tearing down the pipe. **`createManagedWatchSession`** refcount-gates chokidar: MCP acquires one client before `connect` and **`forceStop`** drains the watcher on disconnect; HTTP acquires per authenticated request (after auth; **`GET /health`** excluded) and **`releaseClient`** stops the watcher when the count hits zero. **No MCP idle timeout:** `codemap mcp` does **not** exit after N minutes without tool calls while the stdio pipe stays open. IDE hosts spawn MCP once per session and do not reliably respawn it mid-conversation — an idle shutdown would break long pauses (human think time, reading, multi-step plans) with no recovery path. Orphan cleanup is handled by **disconnect detection**, not inactivity timers. **HTTP watch release grace (`HTTP_WATCH_RELEASE_GRACE_MS` = 5000):** distinct from idle timeout — only stops chokidar between stateless requests so the watcher is not started/stopped on every POST; the HTTP listener keeps running. **`GET /health`** liveness probes do not acquire a watch client (probes must not keep chokidar hot). Future **`MCP shared daemon per project`** could revisit opt-in idle policies with explicit client reconnect; not planned for stdio MCP today.

**Performance wiring:** **`--performance`** plumbs through **`RunIndexOptions.performance`** → **`indexFiles({ performance, collectMs })`**. `parse-worker-core.ts` records per-file **`parseMs`** on each `ParsedFile`; main thread times the eight phases (`collect`, `parse`, `insert`, `index_create`, `bindings`, `module_cycles`, `re_export_chains`, `heritage`) and assembles **`IndexPerformanceReport`** under `IndexRunStats.performance`. Note: `total_ms` is `indexFiles` wall-clock (parse + insert + DDL + bindings + cycles + re_exports + heritage), **not** end-to-end run wall — `collect_ms` happens before `indexFiles` and is reported separately. Env var **`CODEMAP_PERFORMANCE_JSON=<path>`** dumps the report as JSON post-run (consumed by [`bun run check:perf-baseline`](./benchmark.md#perf-baseline-regression-guardrail) for local + weekly scheduled drift checks — not a PR merge gate).

**Agent templates:** `codemap agents init` writes thin pointer files (~16-line SKILL + ~23-line rule) to consumer disk; full content is served live by `codemap skill` / `codemap rule` (CLI) and `codemap://skill` / `codemap://rule` (MCP / HTTP) from `templates/agent-content/<kind>/*.md`. Section files concatenate in lexical order; `*.gen.md` sections dispatch to renderers in `application/agent-content.ts` so recipe catalog + schema DDL auto-register. Pointer-version stamp (`<!-- codemap-pointer-version: N -->`) + once-per-process stderr nag (`maybeWarnStalePointers`) flag stale consumer templates; cure is `codemap agents init --force`. Full matrix: [agents.md](./agents.md).

**Timings and methodology:** [benchmark.md](./benchmark.md). **Startup / Node vs Bun** (not the same as benchmark scenarios): [benchmark.md § CLI and runtime startup](./benchmark.md#cli-and-runtime-startup).

### Help, version, and invalid argv

**`--help`** / **`-h`**, **`version`** / **`--version`** / **`-V`** are handled in **`src/cli/bootstrap.ts`** / **`src/cli/main.ts`** before config or DB access. Unknown **`--…`** flags and stray tokens for the default index mode are rejected with an error (see **`validateIndexModeArgs`**) instead of falling through to indexing.

### `--files` (targeted reindex)

When specific file paths are passed via `--files`, the indexer skips git diff, git status, and the full filesystem glob scan. It reads the set of already-indexed paths from the database (for import resolution), then only processes the listed files. Files with non-standard extensions (e.g. custom `include` globs) are accepted and indexed as text; a warning is printed but they are not skipped. Files that no longer exist on disk are automatically removed from the index via `ON DELETE CASCADE`.

## Programmatic usage

The npm package exports **`createCodemap`**, **`Codemap`** (`query`, `index`), **`runCodemapIndex`** (advanced), **`codemapUserConfigSchema`**, **`parseCodemapUserConfig`**, **`defineConfig`**, **`CodemapDatabase`** (type), adapter types (`LanguageAdapter`, `getAdapterForExtension`, …), and **`ParsedFile`** — see **`src/api.ts`** / **`src/index.ts`** and **`dist/index.d.mts`**. Typical flow:

1. **`await createCodemap({ root, configFile?, config? })`** — loads `<state-dir>/config.{ts,js,json}`, calls **`initCodemap`** and **`configureResolver`**.
2. **`await cm.index({ mode, files?, quiet? })`** — same pipeline as the CLI (incremental / full / targeted).
3. **`cm.query(sql)`** — read-only SQL against `.codemap/index.db` (opens the DB per call).

**Constraint:** `initCodemap` is global to the process; only one active indexed project at a time.

### User config

Optional **`<state-dir>/config.{ts,js,json}`** (default `.codemap/config.*`; default export: object or async factory). **`--config <path>`** overrides with an explicit file (absolute or relative to cwd). Example shape: [`codemap.config.example.json`](../codemap.config.example.json). **Self-healing (D11):** `<state-dir>/.gitignore` is reconciled to canonical on every codemap boot via **`ensureStateGitignore`** (`src/application/state-dir.ts`); JSON config is reconciled via **`ensureStateConfig`** (`src/application/state-config.ts` — prunes unknown keys with a warning, sorts alphabetically, write-only-on-drift). TS/JS configs are validate-only at load time. Bumping the canonical `STATE_GITIGNORE_BODY` constant or the Zod schema IS the migration — every consumer's project repairs itself on next boot. Single attachment point: **`src/cli/bootstrap-codemap.ts`** runs the reconcilers before `loadUserConfig`.

**Validation:** **`codemapUserConfigSchema`** ([Zod](https://zod.dev)) — strict object (unknown keys are rejected). **`defineConfig({ ... })`**, **`parseCodemapUserConfig`**, and **`resolveCodemapConfig`** (CLI and merged `createCodemap({ config })`) all go through the same schema. Invalid config throws **`TypeError`** with a short path/message list.

**Exports:** `codemapUserConfigSchema`, `parseCodemapUserConfig`, `defineConfig`, and **`CodemapUserConfig`** (inferred type) from the package entry — see **`src/config.ts`** / **`dist/index.d.mts`**.

## Schema

> **Schema-growth principle:** schema breadth is the substrate every recipe layers on. Slimming a column for theoretical perf / simplicity is a regression unless empirically unread. See [`roadmap.md § Non-goals (v1) → Moats`](./roadmap.md#moats-load-bearing) — Moat B is the canonical home for this discipline.

**Fingerprints:** incremental runs compare **`files.content_hash`** — SHA-256 hex of raw file bytes from [`src/hash.ts`](../src/hash.ts) (same on Node and Bun). Details in the **`files`** table below.

**Fresh database:** the default CLI **`codemap`** (incremental) calls **`createSchema()`** in **`runCodemapIndex`** before **`getChangedFiles()`**, so the **`meta`** table exists before **`getMeta(..., "last_indexed_commit")`** runs on an empty **`.codemap/index.db`**.

Current schema version: **35** — see [Schema Versioning](#schema-versioning) for details.

All base tables use `STRICT` mode; **`source_fts`** is an FTS5 virtual table (no `STRICT`). Tables marked with `WITHOUT ROWID` store data directly in the primary key B-tree. PRAGMAs and index design: [SQLite Performance Configuration](#sqlite-performance-configuration).

### `files` — Every indexed file (`STRICT`)

| Column           | Type    | Description                                                          |
| ---------------- | ------- | -------------------------------------------------------------------- |
| path             | TEXT PK | Relative path from project root                                      |
| content_hash     | TEXT    | SHA-256 hex — see **Fingerprints** at § Schema                       |
| size             | INTEGER | File size in bytes                                                   |
| line_count       | INTEGER | Total lines                                                          |
| language         | TEXT    | `ts`, `tsx`, `css`, `md`, etc.                                       |
| last_modified    | INTEGER | File mtime (epoch ms)                                                |
| indexed_at       | INTEGER | When this row was written                                            |
| is_barrel        | INTEGER | 1 when every export is a re-export and no local value symbols exist  |
| has_side_effects | INTEGER | 1 when module-level calls or assignments were detected at parse time |

### `symbols` — Functions, constants, classes, interfaces, types, enums (`STRICT`)

| Column            | Type       | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                | INTEGER PK | Auto-increment row id                                                                                                                                                                                                                                                                                                                                                                                                       |
| file_path         | TEXT FK    | References `files(path)` ON DELETE CASCADE                                                                                                                                                                                                                                                                                                                                                                                  |
| name              | TEXT       | Symbol name                                                                                                                                                                                                                                                                                                                                                                                                                 |
| kind              | TEXT       | `function`, `const`, `let`, `var`, `class`, `interface`, `type`, `enum`, `method`, `property`, `getter`, `setter` (last four are class members). `let` / `var` are distinct from `const` so callers can filter on mutability (e.g. `WHERE kind = 'const'` excludes mutable bindings; `WHERE kind IN ('let','var')` lists reassignable ones).                                                                                |
| line_start        | INTEGER    | Start line (1-based)                                                                                                                                                                                                                                                                                                                                                                                                        |
| line_end          | INTEGER    | End line                                                                                                                                                                                                                                                                                                                                                                                                                    |
| signature         | TEXT       | Reconstructed signature with generics and return types (e.g. `identity<T>(val): T`, `interface Repo<T> extends Iterable<T>`, `class Store<T> extends Base<T> implements IStore<T>`)                                                                                                                                                                                                                                         |
| is_exported       | INTEGER    | 1 if exported                                                                                                                                                                                                                                                                                                                                                                                                               |
| is_default_export | INTEGER    | 1 if default export                                                                                                                                                                                                                                                                                                                                                                                                         |
| members           | TEXT       | JSON array of enum members (NULL for non-enums). Each entry: `{"name":"…","value":"…"}` (value omitted for implicit-value enums)                                                                                                                                                                                                                                                                                            |
| doc_comment       | TEXT       | Leading JSDoc comment text (cleaned: `*` prefixes stripped, trimmed). NULL when absent. Preserves `@deprecated`, `@param`, etc. tags                                                                                                                                                                                                                                                                                        |
| value             | TEXT       | Literal value for `const` declarations (strings, numbers, booleans, `null`). NULL for non-literal or non-const symbols. Handles `as const` and simple template literals                                                                                                                                                                                                                                                     |
| parent_name       | TEXT       | Nearest **named** enclosing scope (class, function, method, arrow-assigned-to-const). Walks past anonymous arrows / IIFEs / callbacks (e.g. `forEach(() => …)` inside `foo` → `parent_name='foo'`). NULL when no named owner exists — true module-scope OR inside a top-level anonymous IIFE. **For a strict "module-scope only" filter use `scope_local_id = 0`** (the canonical answer), not `parent_name IS NULL`        |
| visibility        | TEXT       | JSDoc visibility tag derived from `doc_comment` at parse time: `public` / `private` / `internal` / `alpha` / `beta`. NULL when no tag present. Tag must start its own line (after the JSDoc `*` prefix); first match in document order wins. Powers the `visibility-tags` recipe and `WHERE visibility = ?` queries via the partial index `idx_symbols_visibility`                                                          |
| complexity        | REAL       | Cyclomatic complexity (McCabe; `1 + decision points`) for function-shaped symbols only. NULL for non-functions (interfaces, types, enums, plain consts) and class methods (v1 limitation). Decision points: `if`, `while`, `do…while`, `for`, `for…in`, `for…of`, `case X:` arms (not `default:`), short-circuit logical/nullish operators, ternary `?:`, and `catch` clauses. Powers the `high-complexity-untested` recipe |
| name_column_start | INTEGER    | 0-based column of the symbol-name token on `line_start` (per [R.6])                                                                                                                                                                                                                                                                                                                                                         |
| name_column_end   | INTEGER    | One-past-last column of the symbol-name token                                                                                                                                                                                                                                                                                                                                                                               |
| scope_local_id    | INTEGER    | Enclosing scope where the symbol's NAME is declared (joins `scopes.local_id`). Default `0` (module)                                                                                                                                                                                                                                                                                                                         |
| body_line_count   | INTEGER    | `line_end - line_start + 1` for function-shaped symbols; NULL for non-functions                                                                                                                                                                                                                                                                                                                                             |
| param_count       | INTEGER    | Parameter count for function-shaped symbols; NULL otherwise                                                                                                                                                                                                                                                                                                                                                                 |
| nesting_depth     | INTEGER    | Max conditional/loop/ternary nesting inside the body; NULL for non-functions                                                                                                                                                                                                                                                                                                                                                |
| return_type       | TEXT       | Stringified return type for function-shaped symbols; NULL when unannotated or N/A                                                                                                                                                                                                                                                                                                                                           |
| is_async          | INTEGER    | 1 for async function-shaped symbols (`function`, `method`, arrow-assigned `function` kind)                                                                                                                                                                                                                                                                                                                                  |
| is_generator      | INTEGER    | 1 for generator function-shaped symbols                                                                                                                                                                                                                                                                                                                                                                                     |

### `calls` — Function-scoped call edges, deduped per file (`STRICT`)

| Column              | Type       | Description                                                                                                                       |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| id                  | INTEGER PK | Auto-increment row id                                                                                                             |
| file_path           | TEXT FK    | References `files(path)` ON DELETE CASCADE                                                                                        |
| caller_name         | TEXT       | Name of the calling function/method                                                                                               |
| caller_scope        | TEXT       | Dot-joined scope path (e.g. `UserService.run`). Anonymous scopes encode as `$anon_<localId>` to avoid sibling-callback collisions |
| callee_name         | TEXT       | Name of the called function, `obj.method` / `obj.foo.bar` for member chains (recursive flatten), `this.method` for self           |
| line_start          | INTEGER    | 1-based line of the callee identifier token (per [R.6])                                                                           |
| column_start        | INTEGER    | 0-based byte column of the callee token                                                                                           |
| column_end          | INTEGER    | One-past-last column                                                                                                              |
| args_count          | INTEGER    | Argument count; NULL when a spread argument is present                                                                            |
| is_method_call      | INTEGER    | 1 when callee is a member expression (`obj.method()`)                                                                             |
| is_constructor_call | INTEGER    | 1 for `new Foo()` (`NewExpression`)                                                                                               |
| is_optional_chain   | INTEGER    | 1 when the call uses optional chaining (`?.`)                                                                                     |

Edges are deduped per (caller_scope, callee, call vs constructor) per file: if `foo` calls `bar` three times in the same file, only one row is stored. `foo()` and `new Foo()` with the same callee name remain distinct rows. Same-named methods in different classes get distinct `caller_scope` values. Module-level calls (outside any function) are excluded — only function-scoped calls are tracked.

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

### `type_heritage` — Class/interface extends and implements edges (`STRICT`)

| Column              | Type       | Description                                                                                                                         |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| id                  | INTEGER PK | Auto-increment row id                                                                                                               |
| child_file_path     | TEXT FK    | File defining the child type                                                                                                        |
| child_name          | TEXT       | Child class or interface name                                                                                                       |
| child_kind          | TEXT       | `class` or `interface`                                                                                                              |
| child_line_start    | INTEGER    | Child definition line                                                                                                               |
| relation            | TEXT       | `extends` or `implements`                                                                                                           |
| base_simple_name    | TEXT       | Unqualified base name used for graph walks                                                                                          |
| base_qualified_name | TEXT       | Qualified base when present (e.g. `pkg.Type`); `(expression)` marks non-simple extends/implements expressions excluded from resolve |
| base_file_path      | TEXT       | Resolved definition file (null until resolve pass)                                                                                  |
| base_symbol_id      | INTEGER FK | Resolved `symbols.id` (null when unresolved)                                                                                        |
| resolution_kind     | TEXT       | `same-file`, `imported`, `qualified-unresolved`, or `unresolved`                                                                    |
| type_args           | TEXT       | Comma-separated generic args when present (display only; walks use `base_simple_name`)                                              |

Populated at parse time from oxc AST; `heritage-resolver` fills `base_file_path` / `base_symbol_id` after bindings on full rebuild. Incremental `--files` re-resolves rows in changed files plus importers and consumers pointing at changed base files. Powers `type-ancestors` and `type-descendants` recipes.

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

| Column           | Type       | Description                                                                         |
| ---------------- | ---------- | ----------------------------------------------------------------------------------- |
| id               | INTEGER PK | Auto-increment row id                                                               |
| file_path        | TEXT FK    | File containing the export                                                          |
| name             | TEXT       | Exported name                                                                       |
| kind             | TEXT       | `value`, `type`, `re-export`                                                        |
| is_default       | INTEGER    | 1 if default export                                                                 |
| re_export_source | TEXT       | Source module if re-exported (suffix `.default` for `export { default as X } from`) |
| is_re_export     | INTEGER    | 1 when `kind = 're-export'`                                                         |
| line_start       | INTEGER    | 1-based line of the export-name token (per [R.6])                                   |
| line_end         | INTEGER    | 1-based last line of the export declaration                                         |
| column_start     | INTEGER    | 0-based byte column of the name token                                               |
| column_end       | INTEGER    | One-past-last column                                                                |

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

### `import_specifiers` — Per-specifier breakdown of `imports.specifiers` (`STRICT`)

| Column        | Type       | Description                                                                     |
| ------------- | ---------- | ------------------------------------------------------------------------------- |
| id            | INTEGER PK | Auto-increment row id                                                           |
| file_path     | TEXT FK    | File containing the import                                                      |
| source        | TEXT       | Module specifier                                                                |
| line          | INTEGER    | Line number                                                                     |
| column_start  | INTEGER    | 0-based column of the specifier token                                           |
| column_end    | INTEGER    | One-past-last column                                                            |
| imported_name | TEXT       | Original exported name (or `default` / `*`)                                     |
| local_name    | TEXT       | Local binding name (different from `imported_name` for `import { foo as bar }`) |
| kind          | TEXT       | `named` / `default` / `namespace` / `side-effect`                               |
| is_type_only  | INTEGER    | 1 if this specifier is `type`-only                                              |
| import_id     | INTEGER FK | Parent `imports.id`; populated for all specifier rows including side-effect     |

### `scopes` — Lexical scope graph (`STRICT, WITHOUT ROWID`)

Per [R.11]. One row per function / arrow / class / method / interface / type-alias / for / catch + module-root scope (`local_id = 0`).

| Column            | Type    | Description                                                                                         |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------- |
| file_path         | TEXT FK | File containing the scope (PK part 1)                                                               |
| local_id          | INTEGER | Per-file 0-based scope id (PK part 2). Module = 0; nested scopes increment                          |
| kind              | TEXT    | `module` / `function` / `arrow` / `class` / `method` / `interface` / `type-alias` / `for` / `catch` |
| parent_local_id   | INTEGER | Enclosing scope's `local_id`, NULL for the module root                                              |
| line_start        | INTEGER | Body start line                                                                                     |
| line_end          | INTEGER | Body end line                                                                                       |
| owner_symbol_name | TEXT    | Named owner (function/class/method name), NULL for anonymous (callback arrows, catch, for)          |

### `references` — Every identifier USE (`STRICT`)

Per [R.11]. Column-precise per [R.6]. Native HTML JSX tags / attribute names / object-literal long-hand keys / non-computed member accesses are NOT emitted (they're not bindings); the table tracks identifier bindings only. `kind='member'` rows ARE emitted for non-computed property access so consumers that want member-name positions can filter them in.

| Column         | Type       | Description                                                                           |
| -------------- | ---------- | ------------------------------------------------------------------------------------- |
| id             | INTEGER PK | Auto-increment row id                                                                 |
| file_path      | TEXT FK    | File containing the reference                                                         |
| name           | TEXT       | Identifier name                                                                       |
| line_start     | INTEGER    | 1-based line                                                                          |
| column_start   | INTEGER    | 0-based byte column                                                                   |
| column_end     | INTEGER    | One-past-last column                                                                  |
| kind           | TEXT       | `value` / `type` / `jsx` / `member`                                                   |
| scope_local_id | INTEGER    | Enclosing scope (joins `scopes.local_id` in the same file)                            |
| is_write       | INTEGER    | 1 for assignment LHS / `++` / `--` / `delete` / declaration-with-init / for-of/in LHS |

### `bindings` — Per-reference resolution to the originating symbol (`STRICT, WITHOUT ROWID`)

Per [R.12]. One row per non-`member`-kind `references` row. Resolved in a single pass after files+symbols+imports settle (full-rebuild only — targeted reindex skips per [R.10]).

| Column             | Type    | Description                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------- |
| reference_id       | INTEGER | PK + FK → `references(id)` CASCADE                                              |
| resolved_symbol_id | INTEGER | FK → `symbols(id)` SET NULL. NULL for `is_external=1` / `global` / `unresolved` |
| resolution_kind    | TEXT    | `same-file` / `imported` / `re-exported` / `global` / `unresolved`              |
| is_external        | INTEGER | 1 when the import target isn't in the indexed set (e.g. `react`, `lodash`)      |

### `function_params` — Typed parameters per function/method (`STRICT`)

One row per leaf parameter binding, ordered by `position`. Pattern params (`function f({a, b})`) emit one row per leaf.

| Column       | Type       | Description                                                    |
| ------------ | ---------- | -------------------------------------------------------------- |
| id           | INTEGER PK | Auto-increment row id                                          |
| file_path    | TEXT FK    | File containing the owning function                            |
| owner_name   | TEXT       | Function / method / arrow / constructor / getter / setter name |
| owner_kind   | TEXT       | Disambiguates same-name function vs method in the same file    |
| position     | INTEGER    | 0-based index in the params array                              |
| name         | TEXT       | Leaf binding name                                              |
| type_text    | TEXT       | Stringified type annotation (NULL for untyped params)          |
| default_text | TEXT       | Raw default-expression source (NULL when no default)           |
| is_rest      | INTEGER    | 1 for `...rest` params                                         |
| is_optional  | INTEGER    | 1 for `?` or AssignmentPattern (default-valued) params         |
| line_start   | INTEGER    | 1-based line of the binding                                    |
| column_start | INTEGER    | 0-based column of the binding token                            |
| column_end   | INTEGER    | One-past-last column                                           |

### `file_metrics` — Per-file aggregate metrics (`STRICT`)

One row per indexed TS/JS file. Line classification is regex-light (blank if `/^\s*$/`; comment if line starts with `//`, `/*`, `*`, `*/`).

| Column          | Type    | Description                           |
| --------------- | ------- | ------------------------------------- |
| file_path       | TEXT PK | FK → `files(path)` CASCADE            |
| total_lines     | INTEGER | All lines, including blank + comment  |
| code_lines      | INTEGER | `total - blank - comment`             |
| blank_lines     | INTEGER | Whitespace-only lines                 |
| comment_lines   | INTEGER | Lines starting with `//` / `/*` / `*` |
| let_count       | INTEGER | `symbols.kind = 'let'` count          |
| const_count     | INTEGER | `symbols.kind = 'const'` count        |
| var_count       | INTEGER | `symbols.kind = 'var'` count          |
| function_count  | INTEGER | `symbols.kind = 'function'` count     |
| arrow_count     | INTEGER | Reserved (kind disambiguation TBD)    |
| class_count     | INTEGER | `symbols.kind = 'class'` count        |
| interface_count | INTEGER | `symbols.kind = 'interface'` count    |
| export_count    | INTEGER | `exports` row count for this file     |

### `re_export_chains` — Materialised re-export resolution (`STRICT, WITHOUT ROWID`)

One row per `(from_file, from_name)` re-export, walked through barrel files to the terminal definition site. Bounded at 10 hops with cycle detection. Powers `barrel-chains` recipe.

| Column    | Type    | Description                                                    |
| --------- | ------- | -------------------------------------------------------------- |
| from_file | TEXT FK | Re-exporting file (PK part 1)                                  |
| from_name | TEXT    | Name as exported from `from_file` (PK part 2)                  |
| to_file   | TEXT    | Terminal definition site (or last reachable file)              |
| to_name   | TEXT    | Name at the terminal                                           |
| hops      | INTEGER | Chain length walked                                            |
| truncated | INTEGER | 1 if the walk hit the depth cap or an unindexed file mid-chain |

### `module_cycles` — Files participating in import cycles (`STRICT`)

SCCs of size ≥ 2 from `dependencies`, plus size-1 SCCs with a self-edge. Computed via Tarjan after the full index pass. Non-cyclic files have no row.

| Column     | Type    | Description                                                 |
| ---------- | ------- | ----------------------------------------------------------- |
| file_path  | TEXT PK | FK → `files(path)` CASCADE                                  |
| cycle_id   | INTEGER | Per-PR auto-numbered cycle id (shared across cycle members) |
| cycle_size | INTEGER | Number of files in the cycle                                |

### `dynamic_imports` — Dynamic `import()` sites (`STRICT`)

| Column         | Type       | Description                                                           |
| -------------- | ---------- | --------------------------------------------------------------------- |
| id             | INTEGER PK | Auto-increment row id                                                 |
| file_path      | TEXT FK    | Containing file                                                       |
| line_start     | INTEGER    | 1-based line of the module specifier token                            |
| column_start   | INTEGER    | 0-based column of the specifier start                                 |
| source_kind    | TEXT       | `literal` / `template` / `expression`                                 |
| source_text    | TEXT       | Specifier text (literal value, template source, or expression source) |
| resolved_path  | TEXT       | Project-relative path when `source_kind = 'literal'` and resolvable   |
| in_async_fn    | INTEGER    | 1 when the import sits inside an async function body                  |
| scope_local_id | INTEGER    | Enclosing scope (joins `scopes.local_id`; `0` = module)               |

### `jsx_elements` / `jsx_attributes` — JSX substrate (`STRICT`)

Every JSX element and attribute in `.tsx`/`.jsx` files. `parent_element_id` is filled in a post-insert pass within the file. Fragments use `is_fragment = 1` and empty `component_name`.

| Column (elements) | Type       | Description                            |
| ----------------- | ---------- | -------------------------------------- |
| component_name    | TEXT       | Tag name (`ProductCard`, `article`, …) |
| is_self_closing   | INTEGER    | 1 for `<Foo />`                        |
| is_fragment       | INTEGER    | 1 for `<>…</>`                         |
| is_lowercase      | INTEGER    | 1 for native HTML tags                 |
| parent_element_id | INTEGER FK | Parent element row                     |
| children_count    | INTEGER    | Direct JSX child element count         |

| Column (attributes) | Type | Description                                                |
| ------------------- | ---- | ---------------------------------------------------------- |
| element_id          | FK   | Owning `jsx_elements.id`                                   |
| value_kind          | TEXT | `string` / `expression` / `boolean` / `spread` / `element` |

### `async_calls` / `try_catch` / `decorators` / `jsdoc_tags` — Behavioral substrate (`STRICT`)

| Table         | Flagship signal                                                        |
| ------------- | ---------------------------------------------------------------------- |
| `async_calls` | `AwaitExpression` sites with `in_loop` / `in_try` context stack        |
| `try_catch`   | `TryStatement` shape + `catch_logs_only` / `catch_rethrows` heuristics |
| `decorators`  | Decorator name + `target_kind`; `target_symbol_id` linked post-insert  |
| `jsdoc_tags`  | Structured tags (`@param`, `@throws`, …) per symbol from `doc_comment` |

### `runtime_markers` — Operational signals (`STRICT`)

Every `console.*` call, `debugger` statement, `throw` statement, and `process.env.X` access. Powers `find-leftover-console` + `env-var-audit`.

| Column         | Type       | Description                                                                                        |
| -------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| id             | INTEGER PK | Auto-increment row id                                                                              |
| file_path      | TEXT FK    | Containing file                                                                                    |
| kind           | TEXT       | `console` / `debugger` / `throw` / `process-env`                                                   |
| line_start     | INTEGER    | 1-based line                                                                                       |
| column_start   | INTEGER    | 0-based column of the start token                                                                  |
| column_end     | INTEGER    | One-past-last column                                                                               |
| detail         | TEXT       | Method name for `console`, env-var name for `process-env`, truncated thrown expression for `throw` |
| scope_local_id | INTEGER    | Enclosing scope (joins `scopes.local_id`)                                                          |

### `test_suites` — describe / it / test / suite blocks (`STRICT`)

Per-block extraction with skip/only/todo flags + framework detection from imports.

| Column          | Type       | Description                                                                                |
| --------------- | ---------- | ------------------------------------------------------------------------------------------ |
| id              | INTEGER PK | Auto-increment row id                                                                      |
| file_path       | TEXT FK    | Containing file                                                                            |
| name            | TEXT       | Block name (from first string-literal / template arg)                                      |
| kind            | TEXT       | `describe` / `it` / `test` / `suite` / `context`                                           |
| line_start      | INTEGER    | 1-based                                                                                    |
| line_end        | INTEGER    | 1-based                                                                                    |
| parent_suite_id | INTEGER    | FK → `test_suites(id)` CASCADE for nested describes; NULL at top level                     |
| is_skipped      | INTEGER    | 1 for `.skip` modifier                                                                     |
| is_only         | INTEGER    | 1 for `.only` modifier                                                                     |
| is_todo         | INTEGER    | 1 for `.todo` modifier                                                                     |
| framework       | TEXT       | `vitest` / `jest` / `bun-test` / `node-test` / `mocha` / `unknown` (detected from imports) |

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

| Column       | Type       | Description                             |
| ------------ | ---------- | --------------------------------------- |
| id           | INTEGER PK | Auto-increment row id                   |
| file_path    | TEXT FK    | File with the marker                    |
| line_number  | INTEGER    | Line number                             |
| kind         | TEXT       | `TODO`, `FIXME`, `HACK`, or `NOTE`      |
| content      | TEXT       | Comment text                            |
| column_start | INTEGER    | 0-based byte column of the marker token |
| column_end   | INTEGER    | One-past-last column                    |

### `suppressions` — Opt-in recipe suppression markers (`STRICT`)

Parsed from `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` comments (also `#`, `--`, `<!--`, `/*` leaders for non-JS files). Recipes opt in via `LEFT JOIN suppressions s ON s.file_path = … AND s.recipe_id = '<id>' AND (s.line_number = 0 OR s.line_number = <row's line>) WHERE s.id IS NULL`. Stays consistent with the "no opinionated rule engine" floor — no severity, no suppression-by-default, no universal-honor; the suppression is consumer-chosen substrate.

| Column      | Type       | Description                                                                                        |
| ----------- | ---------- | -------------------------------------------------------------------------------------------------- |
| id          | INTEGER PK | Auto-increment row id                                                                              |
| file_path   | TEXT FK    | File the directive lives in                                                                        |
| line_number | INTEGER    | `> 0` = next-line scope (the suppressed line); `0` = file scope (suppress anywhere in `file_path`) |
| recipe_id   | TEXT       | Recipe id the directive targets (e.g. `untested-and-dead`)                                         |

### `meta` — Key-value metadata (`STRICT, WITHOUT ROWID`)

| Column | Type    | Description                                                                |
| ------ | ------- | -------------------------------------------------------------------------- |
| key    | TEXT PK | e.g. `schema_version`, `last_indexed_commit`, `indexed_at`, `fts5_enabled` |
| value  | TEXT    | Stored value                                                               |

The `fts5_enabled` key tracks the FTS5 toggle state at the last reindex; mismatch with the resolved config (config + `--with-fts` CLI) auto-upgrades the next incremental run to a full rebuild so `source_fts` is consistently populated.

### `source_fts` — Opt-in FTS5 virtual table over file content

Always created (near-zero space when empty); populated by the indexer only when the resolved config has FTS5 enabled (`.codemap/config.ts` `fts5: true` OR `--with-fts` CLI flag at index time). Tokenizer `porter unicode61` (Porter stemmer over Unicode-aware tokeniser; ~3× smaller than the trigram alternative). `file_path UNINDEXED` skips tokenising paths since filtering is exact via `WHERE file_path = ?`.

| Column    | Type           | Description                                                                |
| --------- | -------------- | -------------------------------------------------------------------------- |
| file_path | TEXT UNINDEXED | Project-relative path; matches `files.path`                                |
| content   | TEXT           | Verbatim file source — UTF-8 text, no normalisation beyond the tokeniser's |

CLI: `codemap --with-fts --full` enables; toggle change auto-detects and forces a full rebuild. Stderr telemetry `[fts5] source_fts populated: <N> files / <X> KB` on first populate. Bundled recipe `text-in-deprecated-functions` demonstrates the FTS5 ⨯ `symbols` ⨯ `coverage` JOIN.

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

### `coverage` — Statement coverage (user data) (`STRICT, WITHOUT ROWID`)

Statement-level coverage ingested by `codemap ingest-coverage <path>` from Istanbul JSON, LCOV, or V8 runtime (`NODE_V8_COVERAGE=...` directory via `--runtime`). Joinable to `symbols` for "what's untested?" queries. Same lifecycle posture as `query_baselines`: **intentionally absent from `dropAll()`** so `--full` and `SCHEMA_VERSION` rebuilds preserve user ingest. V8 ingest is local-only — no SaaS aggregation.

Natural-key PK `(file_path, name, line_start)` — deliberately **not** a FK to `symbols.id`. `symbols.id` is `INTEGER PRIMARY KEY AUTOINCREMENT`; on `--full` reindex `dropAll()` drops `symbols` and `createTables()` recreates it with fresh ids. A FK with `ON DELETE CASCADE` would wipe every coverage row on every full rebuild, and the recreated symbols wouldn't match the old ids anyway. Natural key sidesteps the entire CASCADE hazard. Trade-off: orphan rows when a file is deleted from the project — cleaned by `DELETE FROM coverage WHERE file_path NOT IN (SELECT path FROM files)` at the end of every ingest.

Three meta keys (`coverage_last_ingested_at` / `_path` / `_format`) record freshness — single ingest at a time, so format is meta-level not per-row.

| Column           | Type    | Description                                                                                               |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| file_path        | TEXT PK | Project-relative path; matches `symbols.file_path`. Forward-slashed (Windows paths normalised on ingest)  |
| name             | TEXT PK | Symbol name (matches `symbols.name`). Same `(file_path, name, line_start)` is unique by construction      |
| line_start       | INT PK  | Symbol's starting line (matches `symbols.line_start`). Disambiguates re-declared names                    |
| coverage_pct     | REAL    | Percentage 0.0–100.0; `NULL` when `total_statements = 0` (zero-statement scope; not the same as 0%)       |
| hit_statements   | INTEGER | Count of statements with `s[id] > 0` after the innermost-wins projection (D7 of plans/coverage-ingestion) |
| total_statements | INTEGER | Count of statements that projected onto this symbol                                                       |

Bundled recipes consuming the table — `untested-and-dead`, `files-by-coverage`, `worst-covered-exports`. Each ships a frontmatter `actions` block (per PR #26) so agents see per-row follow-up hints in `--json` output.

### `recipe_recency` — Per-recipe last-run + run-count (user data) (`STRICT, WITHOUT ROWID`)

Tracks `last_run_at` (epoch ms) + `run_count` per recipe id so agent hosts can rank live recipes ahead of historic ones. Surfaces inline on `--recipes-json` and the matching `codemap://recipes` / `codemap://recipes/{id}` MCP resources (live read every call — the resource cache was dropped to avoid freezing recency at first-read for the server-process lifetime). Same lifecycle posture as `query_baselines` / `coverage`: **intentionally absent from `dropAll()`** so `--full` and `SCHEMA_VERSION` rebuilds preserve user-activity history. Local-only — no upload primitive ever ships (resists telemetry-creep PRs by construction).

Write paths call `tryRecordRecipeRun` (the failure-isolated wrapper around `recordRecipeRun`) from `application/recipe-recency.ts`: `handleQueryRecipe` in `application/tool-handlers.ts` (covers MCP + HTTP for generic recipes), `handleAffected` in the same module (MCP + HTTP for `affected-tests`), `handleTrace` / `handleExplore` / `handleNode` (MCP + HTTP for bundled `call-path` / `symbol-neighborhood`), and the CLI paths `runQueryCmd` in `cli/cmd-query.ts` + `runAffectedCmd` in `cli/cmd-affected.ts` (each keys success locally — `runQueryCmd`'s finally-block uses a `recipeQuerySucceeded` flag, NOT `process.exitCode`, so `--ci`'s deliberate exit-1-on-findings is recognised as success). Counts only successful runs; recency-write failures are swallowed with a stderr `[recency] write failed: <reason>` warning so they NEVER block the recipe response. The 90-day rolling window is enforced eagerly on the write path (single indexed `DELETE` inside `recordRecipeRun` before the upsert); reads filter at SELECT time (`WHERE last_run_at >= cutoff`) and never mutate the DB so the catalog stays side-effect free for `--recipes-json` and the MCP `codemap://recipes` resources.

Default ON; opt-out via `.codemap/config` `recipeRecency: false` (short-circuits before any DB write — no rows ever land). `recipe_id` is loose — matches bundled or project-recipe ids (no `recipes` SQLite table to FK against; project-shadow rows share the bundled row, since only one version is ever reachable per id).

| Column      | Type    | Description                                                                              |
| ----------- | ------- | ---------------------------------------------------------------------------------------- |
| recipe_id   | TEXT PK | Recipe id (matches `QUERY_RECIPES` keys + project-recipe ids in `<state-dir>/recipes/`). |
| last_run_at | INTEGER | Epoch ms of the last successful run.                                                     |
| run_count   | INTEGER | Cumulative successful runs (incremented per call). `INTEGER` wraparound is theoretical.  |

`idx_recipe_recency_last_run` on `last_run_at` keeps both the eager-on-write prune (`DELETE WHERE last_run_at < cutoffMs` inside `recordRecipeRun`) and the read-time filter (`WHERE last_run_at >= cutoffMs` inside `loadRecipeRecency`) indexed scans as project-recipe counts grow. **Boundary discipline (write-path)**: only `application/tool-handlers.ts` + `cli/cmd-query.ts` + `cli/cmd-affected.ts` (+ the test file) may import `tryRecordRecipeRun` / `recordRecipeRun` — re-runnable forbidden-edge query at [§ Boundary verification — `recipe_recency` write path](#boundary-verification--recipe_recency-write-path). **Read-path** (`enrichWithRecency` / `loadRecipeRecency`) is unrestricted — any catalog renderer can import it (today: `cmd-query.ts` for `--recipes-json`, `application/resource-handlers.ts` for `codemap://recipes` + `codemap://recipes/{id}`).

### `boundary_rules` — Architecture-boundary rules (config-derived) (`STRICT, WITHOUT ROWID`)

Reconciled from `.codemap/config.ts` `boundaries: [...]` on every index pass via `reconcileBoundaryRules` in `db.ts`; the wiring lives in `application/run-index.ts` right after `createSchema`. Empty when the user declares no boundaries. Bundled `boundary-violations` recipe joins this table against `dependencies` via SQLite `GLOB` to surface forbidden imports; `--format sarif` lights up automatically because the recipe row aliases `dependencies.from_path` to `file_path` (the existing location-column priority list catches it).

Dropped on every `--full` / `SCHEMA_VERSION` rebuild like the other index tables — the next index pass re-fills it from config, so no migration is needed when the schema bumps. Distinct from `query_baselines` / `coverage`: those are user data and survive rebuilds; `boundary_rules` is config data and is rebuilt deterministically.

| Column    | Type    | Description                                                                                                                                                                   |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name      | TEXT PK | Stable identifier from config — surfaced in recipe rows and SARIF message bodies.                                                                                             |
| from_glob | TEXT    | SQLite `GLOB` pattern matched against `dependencies.from_path` (the file doing the import).                                                                                   |
| to_glob   | TEXT    | SQLite `GLOB` pattern matched against `dependencies.to_path` (the file being imported).                                                                                       |
| action    | TEXT    | `'deny'` or `'allow'` (CHECK constraint). v1 recipe filters on `action = 'deny'`; `'allow'` reserves the slot for future whitelist semantics. Defaults to `'deny'` in config. |

Keep this table tiny by construction — one row per declared boundary. Glob complexity stays in SQLite's `GLOB` (`*` / `?` / `[abc]`); rich shapes (layer ordering, element-type rules, except-self) compile down to extra `boundary_rules` rows or stay user-side per Moat A.

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

Product-shape constraint: [No split-brain incremental index](./roadmap.md#floors-v1-product-shape).

## File Artifacts

Running the indexer produces up to three files under **`<state-dir>/`** (default `.codemap/`), reconciled by the self-managed **`<state-dir>/.gitignore`** on boot — not in the project root:

### `.codemap/index.db`

The main SQLite database file. Contains all tables and indexes. This is the persistent data store that survives between runs. Typically 2-5 MB for this project.

### `.codemap/index.db-wal` (Write-Ahead Log)

Created automatically because the database uses `PRAGMA journal_mode = WAL`. Instead of writing changes directly to the main `.db` file, SQLite appends them to this WAL file first. This enables:

- **Concurrent readers during writes** — readers see a consistent snapshot while the indexer writes
- **Crash safety** — if the process dies mid-write, the WAL is replayed on next open
- **Better write performance** — sequential appends to WAL are faster than random writes to the B-tree

The WAL gets **checkpointed** (merged back into `.codemap/index.db`) periodically by SQLite or when the last connection closes cleanly. After a clean close, this file may be empty (0 bytes) or absent.

### `.codemap/index.db-shm` (Shared Memory)

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

File I/O and parsing dominate full rebuild time. The indexer spawns N worker threads (capped at CPU count, min 2, max 6; override **`CODEMAP_PARSE_WORKERS`**, max 32) via `parse-worker.ts`. Each worker receives a chunk of file paths, reads files from disk, and runs the appropriate parser (oxc-parser, lightningcss, or regex). Per-file parse budget: **`CODEMAP_PARSE_TIMEOUT_MS`** when set, else 10s + ~1ms per 50KB file size capped at 30s (`parse-timeout.ts`); multi-file worker messages cap the sum at 120s. `worker-pool.ts` clears the parse timeout when the worker responds (or on `dispose`) so the process does not wait on orphaned timers after indexing finishes. Workers recycle after **`CODEMAP_WORKER_RECYCLE_EVERY`** files (default 250) to limit memory growth. Timeouts and other per-file failures append to `<state-dir>/errors.log` without aborting the run. Workers return structured `ParsedFile` results to the main thread, which handles import resolution and database inserts serially.

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

- **Pre-computes placeholder strings** — `batchSizeForTuple()` picks row count per tuple width (cap **`MAX_ROWS_PER_BATCH = 5000`**); full-batch placeholders are reused, tail batches get dynamic placeholders
- **Eliminates `.slice()` allocations** — iterates with index bounds (`i` to `end`) instead of copying array segments per batch
- **Uses indexed `for (let j)` loops** — avoids per-batch iterator protocol overhead

Multi-row `INSERT ... VALUES (...),(...),(...)` batches reduce per-statement overhead (parse, plan, execute cycle) significantly.

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

The `meta` table stores `schema_version`. The canonical version is `SCHEMA_VERSION` in `db.ts` (exported). `createSchema()` persists `String(SCHEMA_VERSION)` after building tables and indexes; index runs call that schema bootstrap before indexing.

**When to bump.** Only when a DDL change FORCES a rebuild — i.e. an existing `.codemap/index.db` from the previous version would be incorrect or incompatible with the new code (column drop, type change, breaking constraint shift, table rename). Purely additive tables / columns / indexes that land via `CREATE … IF NOT EXISTS` on next boot DON'T need a bump — that's the `query_baselines` / `coverage` / `recipe_recency` precedent (each landed without a bump and existing DBs picked them up automatically). Bumping triggers `dropAll()` and a full reindex; doing it for additive changes burns ~85ms (per `benchmark.md`) for zero migration benefit. See also [`.agents/lessons.md`](../.agents/lessons.md) "changesets bump policy (pre-v1)" — a `SCHEMA_VERSION` bump always rides with a `minor` changeset; additive tables ride patch.

When `SCHEMA_VERSION` changes, the indexer auto-detects the mismatch and triggers a full rebuild — no manual intervention needed.

### Boundary verification — `recipe_recency` write path

Re-runnable kit, lifted from the engine module so the docstring stays slim. Only `application/tool-handlers.ts` + `cli/cmd-query.ts` + `cli/cmd-affected.ts` (+ the test file) may import the write-path symbols (`tryRecordRecipeRun` / `recordRecipeRun`):

```bash
bun src/index.ts query --json "
  SELECT DISTINCT file_path FROM imports
  WHERE source LIKE '%application/recipe-recency%'
    -- Quoted-name match (specifiers is JSON) — explicit so a future
    -- symbol like 'recordRecipeRunner' wouldn't false-positive.
    AND (specifiers LIKE '%\"recordRecipeRun\"%'
         OR specifiers LIKE '%\"tryRecordRecipeRun\"%')
    AND file_path NOT IN ('src/application/tool-handlers.ts',
                          'src/cli/cmd-query.ts',
                          'src/cli/cmd-affected.ts',
                          'src/application/recipe-recency.test.ts')
"
```

Expected: `[]`. Non-empty = a new write site appeared without a docs update — escalate per [`audit-pr-architecture` skill](../.agents/skills/audit-pr-architecture/SKILL.md). Read-path imports (`enrichWithRecency` / `loadRecipeRecency`) are unrestricted by design.

### Boundary verification — apply write path

`apply-engine.ts` exports a write-only verb; only `cli/cmd-apply.ts` + `application/tool-handlers.ts` (+ the test files) may import `applyDiffPayload`. Re-runnable kit:

```bash
bun src/index.ts query --json "
  SELECT DISTINCT file_path FROM imports
  WHERE source LIKE '%application/apply-engine%'
    AND (specifiers LIKE '%\"applyDiffPayload\"%')
    AND file_path NOT IN ('src/cli/cmd-apply.ts',
                          'src/application/tool-handlers.ts',
                          'src/application/apply-engine.test.ts',
                          'src/cli/cmd-apply.test.ts')
"
```

Expected: `[]`. Non-empty = a new caller appeared without a docs update — escalate per [`audit-pr-architecture` skill](../.agents/skills/audit-pr-architecture/SKILL.md).

### Boundary verification — `agents-template-path` leaf

`agents-template-path.ts` is the leaf bundled-template resolver; only init + live-fetch surfaces may import it (tests included). Re-runnable kit:

```bash
bun src/index.ts query --json "
  SELECT DISTINCT file_path FROM imports
  WHERE source LIKE '%agents-template-path%'
    AND (specifiers LIKE '%\"resolveAgentsTemplateDir\"%')
    AND file_path NOT IN ('src/agents-init.ts',
                          'src/application/agent-content.ts',
                          'src/application/query-recipes.ts',
                          'src/agents-init.test.ts')
"
```

Expected: `[]`. **`application/` must not import `agents-init`** for template resolution:

```bash
bun src/index.ts query --json "
  SELECT DISTINCT file_path, source FROM imports
  WHERE file_path LIKE 'src/application/%'
    AND source LIKE '%agents-init%'
"
```

Expected: `[]`.

## SQLite Performance Configuration

### `bun:sqlite` API

All DDL and PRAGMA statements use `Database.run()`. The `sqlite-db.ts` wrapper abstracts both Bun (`bun:sqlite`) and Node (`better-sqlite3`). On Bun, `Database.query()` caches compiled statements internally. On Node, the wrapper maintains a `Map<string, Statement>` cache so repeated `run()` and `query()` calls with the same SQL reuse a single prepared statement. Read queries use the wrapper's `.query().all()` or `.get()`. Bulk inserts use the generic `batchInsert<T>()` helper with dynamic multi-row batches via `batchSizeForTuple()`, pre-computed placeholders, and zero-copy index-bounds iteration.

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
- `scopes`, `bindings`, `re_export_chains`, `coverage`, `recipe_recency`, `boundary_rules`
- `meta` (PK: `key`)

### STRICT tables

All base tables use `STRICT` mode (`source_fts` is a virtual table and exempt), which enforces column types at insert time — an INTEGER column rejects TEXT values and vice versa. Catches data corruption bugs immediately rather than silently coercing types. Combined with `WITHOUT ROWID` on applicable tables: `STRICT, WITHOUT ROWID`.

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
