# Codemap — Architecture

See [documentation index](./README.md).

## Overview

A local SQLite database (`.codemap/index.db`) indexes the project tree and stores structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers) for SQL queries instead of repeated full-tree scans.

### Runtime and database

**`src/sqlite-db.ts`:** Node uses **`better-sqlite3`**; Bun uses **`bun:sqlite`**. Same schema everywhere. **`better-sqlite3`** allows **one SQL statement per `prepare()`**; **`bun:sqlite`** accepts **multiple statements** in one `run()`. On Node, **`runSql()`** splits multi-statement strings on **`;`** and runs each fragment. Do **not** put **`;`** inside **`--` line comments** in **`db.ts`** DDL strings (naive split would break). Details: [packaging.md § Node vs Bun](./packaging.md#node-vs-bun).

**`src/worker-pool.ts`:** Bun `Worker` or Node `worker_threads`. **`src/glob-sync.ts`:** Bun **`Glob`** or **`tinyglobby`** for include patterns. **`src/config.ts`:** loads **`<state-dir>/config.{ts,js,json}`** (JSON read path: **`Bun.file`** on Bun, **`readFile` + `JSON.parse`** on Node — [packaging.md § Node vs Bun](./packaging.md#node-vs-bun)), then validates with **Zod** (`codemapUserConfigSchema`). Details: [User config](#user-config). State directory resolved via **`src/application/state-dir.ts`** (`resolveStateDir`); precedence `--state-dir <path>` > `CODEMAP_STATE_DIR` > `.codemap/`.

**Shipped artifact:** **`dist/`** — `package.json` **`bin`** and **`exports`** both point at **`dist/index.mjs`** ([packaging.md](./packaging.md)); tsdown also emits **lazy CLI chunks** (`cmd-index`, `cmd-query`, `cmd-agents`, …) loaded via **`import()`** from **`src/cli/main.ts`**.

## Layering

| Layer                                        | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`cli/`** (`bootstrap`, `main`, `cmd-*`)    | Parses argv; **dynamic `import()`** loads only the command chunk (`cmd-index`, `cmd-query`, `cmd-agents`) so `--help` / `version` / `agents init` avoid the indexer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`api.ts`**                                 | Public programmatic surface: `createCodemap()`, `Codemap` (`query`, `index`), re-exports `runCodemapIndex` for advanced use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`application/`**                           | Pure transport-agnostic engines + handlers: `run-index.ts` / `index-engine.ts` (orchestration + indexing); `query-engine.ts` (`executeQuery` / `executeQueryBatch`); `audit-engine.ts` (`runAudit` + `resolveAuditBaselines` + `runAuditFromRef` + `makeWorktreeReindex`); `audit-worktree.ts` (sha-keyed cache + atomic populate); `context-engine.ts` (`buildContextEnvelope`); `validate-engine.ts` (`computeValidateRows` + `toProjectRelative`); `show-engine.ts` (lookup + envelope builders); `impact-engine.ts` (`findImpact` — graph blast-radius walker); `coverage-engine.ts` (`upsertCoverageRows` core + `ingestIstanbul` / `ingestLcov` / `ingestV8` parsers; schema in [§ Schema → coverage](#schema)); `query-recipes.ts` + `recipes-loader.ts` (recipe registry); `output-formatters.ts` (SARIF + GH annotations + Mermaid `flowchart LR` with bounded-input contract); `watcher.ts` (chokidar-backed debounced reindex; pure helpers + injectable backend); `tool-handlers.ts` + `resource-handlers.ts` (transport-agnostic tool / resource handlers shared by MCP + HTTP); `mcp-server.ts` (MCP transport — stdio); `http-server.ts` (HTTP transport — `node:http`). Engines depend on `db.ts` / `runtime.ts`; **never** on `cli/`. |
| **`adapters/`**                              | `LanguageAdapter` registry; built-ins call `parser.ts` / `css-parser.ts` / `markers.ts` from `parse-worker-core`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`runtime.ts` / `config.ts` / `db.ts` / …** | Config, SQLite, resolver, workers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
    └─ .codemap/index.db
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
    └─ .codemap/index.db
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

| File                                                                                              | Purpose                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                                                        | Package entry — re-exports `api` / `config`, runs CLI when main                                                                                                                                                                                                  |
| `cli/`                                                                                            | CLI — bootstrap argv, lazy command modules, `query` / `validate` / `context` / `agents init` / index modes                                                                                                                                                       |
| `api.ts`                                                                                          | Programmatic API — `createCodemap`, `Codemap`, `runCodemapIndex`                                                                                                                                                                                                 |
| `application/`                                                                                    | Pure transport-agnostic engines (`run-index`, `index-engine`, `query-engine`, `audit-engine`, `context-engine`, `validate-engine`, `show-engine`, `impact-engine`, `coverage-engine`, `query-recipes`, `recipes-loader`, `mcp-server`, `http-server`, `watcher`) |
| `worker-pool.ts`                                                                                  | Parallel parse workers (Bun / Node)                                                                                                                                                                                                                              |
| `db.ts`                                                                                           | SQLite adapter — schema DDL, typed CRUD, connection management                                                                                                                                                                                                   |
| `parser.ts`                                                                                       | TS/TSX/JS/JSX extraction via `oxc-parser` — symbols (with JSDoc + generics + return types), type members, imports, exports, components, markers                                                                                                                  |
| `css-parser.ts`                                                                                   | CSS extraction via `lightningcss` — custom properties, classes, keyframes, `@theme` blocks                                                                                                                                                                       |
| `resolver.ts`                                                                                     | Import path resolution via `oxc-resolver` — respects `tsconfig` aliases, builds dependency graph                                                                                                                                                                 |
| `constants.ts`                                                                                    | Shared constants — e.g. `LANG_MAP`                                                                                                                                                                                                                               |
| `glob-sync.ts`                                                                                    | Include globs — Bun `Glob` vs `tinyglobby` on Node ([packaging § Node vs Bun](./packaging.md#node-vs-bun))                                                                                                                                                       |
| `markers.ts`                                                                                      | Shared marker extraction (`TODO`/`FIXME`/`HACK`/`NOTE`) + `extractSuppressions` for opt-in `// codemap-ignore-{next-line,file} <recipe-id>` directives — used by all parsers                                                                                     |
| `parse-worker.ts`                                                                                 | Worker thread entry point — reads, parses, and extracts file data in parallel                                                                                                                                                                                    |
| `adapters/`                                                                                       | `LanguageAdapter` types and built-in TS/CSS/text implementations                                                                                                                                                                                                 |
| `parsed-types.ts`                                                                                 | Shared `ParsedFile` shape for workers and adapters                                                                                                                                                                                                               |
| `agents-init.ts` / `agents-init-interactive.ts`                                                   | `codemap agents init` — see [agents.md](./agents.md) (granular template + IDE writes, pointer upsert, **`--interactive`**, `.gitignore`)                                                                                                                         |
| `benchmark.ts` (+ `benchmark-default-scenarios.ts`, `benchmark-config.ts`, `benchmark-common.ts`) | SQL vs traditional timing; optional **`CODEMAP_BENCHMARK_CONFIG`** JSON — [benchmark.md § Custom scenarios](./benchmark.md#custom-scenarios-codemap_benchmark_config)                                                                                            |
| `config.ts`                                                                                       | `<state-dir>/config.{ts,js,json}` load path, **Zod** user schema (`codemapUserConfigSchema`), `resolveCodemapConfig`                                                                                                                                             |

## CLI usage

**Commands and flags** (index, query, **`codemap agents init`**, **`--root`**, **`--config`**, environment): [../README.md § CLI](../README.md#cli) — **do not duplicate** flag lists here; this section only adds implementation notes. From this repository: **`bun run dev`** or **`bun src/index.ts`** (same flags).

**Query wiring:** **`src/cli/cmd-query.ts`** (argv, **`printQueryResult`**, `--recipe` / `-r` alias, **`--summary`**, **`--changed-since`**, **`--group-by`**, **`--save-baseline`** / **`--baseline`** / **`--baselines`** / **`--drop-baseline`**, **`--ci`** (aliases `--format sarif` + non-zero exit on findings + quiet)), **`src/application/query-recipes.ts`** (**`QUERY_RECIPES`** — bundled SQL only source; optional **`actions: RecipeAction[]`** per recipe), **`src/cli/main.ts`** (**`--recipes-json`** / **`--print-sql`** exit before config/DB). With **`--json`**, errors use **`{"error":"…"}`** on stdout for SQL failures, DB open, and bootstrap (same shape); **`runQueryCmd`** sets **`process.exitCode`** instead of **`process.exit`**. Friendlier "no `.codemap/index.db`" — `no such table: <X>` and `no such column: <X>` errors are rewritten in **`enrichQueryError`** to point at `codemap` / `codemap --full`. **`--summary`** filters output only — the SQL still executes against the index; output collapses to `{"count": N}` (with `--json`) or `count: N`. **`--changed-since <ref>`** post-filters result rows by `path` / `file_path` / `from_path` / `to_path` / `resolved_path` against `git diff --name-only <ref>...HEAD ∪ git status --porcelain` (helper: **`src/git-changed.ts`** — `getFilesChangedSince`, `filterRowsByChangedFiles`, `PATH_COLUMNS`); rows with no recognised path column pass through. **`--group-by <mode>`** (`owner` | `directory` | `package`) routes through **`runGroupedQuery`** in `cmd-query.ts` and emits `{"group_by": "<mode>", "groups": [{key, count, rows}]}` (or `[{key, count}]` with `--summary`); helpers in **`src/group-by.ts`** (`groupRowsBy`, `firstDirectory`, `loadCodeowners`, `discoverWorkspaceRoots`, `makePackageBucketizer`, `codeownersGlobToRegex`). CODEOWNERS lookup is last-match-wins (GitHub semantics); workspace discovery reads `package.json` `workspaces` and `pnpm-workspace.yaml` `packages:`. **`--save-baseline[=<name>]`** snapshots the result to the **`query_baselines`** table inside `.codemap/index.db` (no parallel JSON files; survives `--full` / SCHEMA bumps because the table is intentionally absent from `dropAll()`); name defaults to `--recipe` id, ad-hoc SQL needs an explicit name. **`--baseline[=<name>]`** replays the SQL, fetches the saved row set, and emits `{baseline:{...}, current_row_count, added: [...], removed: [...]}` (or `{baseline:{...}, current_row_count, added: N, removed: N}` with `--summary`); identity is per-row multiset equality (canonical `JSON.stringify` keyed frequency map — duplicate rows are tracked, not collapsed). No fuzzy "changed" category in v1. **`--group-by` is mutually exclusive** with both `--save-baseline` and `--baseline` (different output shapes). **`--baselines`** (read-only list) and **`--drop-baseline <name>`** complete the surface; helpers in **`src/db.ts`** (`upsertQueryBaseline`, `getQueryBaseline`, `listQueryBaselines`, `deleteQueryBaseline`). **Per-row recipe `actions`** are appended only when the user runs **`--recipe <id>`** with **`--json`** AND the recipe defines an `actions` template — programmatic `cm.query(sql)` and ad-hoc CLI SQL never carry actions; under `--baseline`, actions attach to `added` rows only (the rows the agent should act on). The **`components-by-hooks`** recipe ranks by hook count with a **comma-based tally** on **`hooks_used`** (no SQLite JSON1). Shipped **`templates/agents/`** documents **`codemap query --json`** as the primary agent example ([README § CLI](../README.md#cli)).

**Output formatters:** **`src/application/output-formatters.ts`** — pure transport-agnostic; **`formatSarif`** emits SARIF 2.1.0 (auto-detected location columns: `file_path` / `path` / `to_path` / `from_path` priority + optional `line_start` / `line_end` region; `rule.id = codemap.<recipe-id>` for `--recipe`, `codemap.adhoc` for ad-hoc SQL; aggregate recipes without locations → `results: []` + stderr warning); **`formatAuditSarif`** emits the audit-shaped variant — one rule per delta key (`codemap.audit.<key>-added`), one result per `added` row at severity `warning`; `removed` rows excluded (SARIF surfaces findings, not cleanups); location-only rows fall back to `"new <key>: <uri>"` messages; **`formatAnnotations`** emits `::notice file=…,line=…::msg` GitHub Actions workflow commands (one line per locatable row; messages collapsed to a single line because the GH parser stops at the first newline); **`formatMermaid`** emits a `flowchart LR` from `{from, to, label?, kind?}` rows with a hard `MERMAID_MAX_EDGES = 50` ceiling — unbounded inputs reject with a scope-suggestion error naming the recipe + count + `LIMIT` / `--via` / `WHERE` knobs (auto-truncation deliberately out of scope; would be a verdict masquerading as output mode); **`formatDiff`** emits read-only unified diff text from `{file_path, line_start, before_pattern, after_pattern}` rows; **`formatDiffJson`** emits structured `{files, warnings, summary}` hunks for agents. Diff formatters read source files at format time and surface `stale` / `missing` flags when the indexed line no longer matches. Wired into both **`src/cli/cmd-query.ts`** (`--format <text|json|sarif|annotations|mermaid|diff|diff-json>`; `--format` overrides `--json`; formatted outputs reject `--summary` / `--group-by` / baseline at parse time) and the MCP **`query`** / **`query_recipe`** tools (`format: "sarif" | "annotations" | "mermaid" | "diff" | "diff-json"` with the same incompatibility guard). Per-recipe `sarifLevel` / `sarifMessage` / `sarifRuleId` overrides via frontmatter on `<id>.md` deferred to v1.x.

**Validate wiring:** **`src/cli/cmd-validate.ts`** (argv + render) + **`src/application/validate-engine.ts`** (engine — **`computeValidateRows`** + **`toProjectRelative`**). `computeValidateRows` is a pure function over `(db, projectRoot, paths)` returning `{path, status}` rows where `status ∈ stale | missing | unindexed`. CLI wraps it with read-once-and-print + exits **1** on any drift (git-status semantics). Path normalization: **`toProjectRelative`** converts CLI input to POSIX-style relative keys matching the `files.path` storage format (Windows backslash → forward slash); same convention as `lint-staged.config.js`. Also reused by `cmd-show.ts` / `cmd-snippet.ts` and the MCP show/snippet handlers — single canonical implementation.

**Audit wiring:** **`src/cli/cmd-audit.ts`** (argv, `--baseline <prefix>` auto-resolve sugar, `--<key>-baseline <name>` per-delta explicit overrides, `--base <ref>` git-ref baseline, `--format <text|json|sarif>`, `--json` (= `--format json` shortcut), `--ci` (aliases `--format sarif` + non-zero exit on additions + quiet), `--summary`, `--no-index`) + **`src/application/audit-engine.ts`** (delta registry + diff). SARIF emit goes through `output-formatters.ts`'s `formatAuditSarif` — one rule per delta key (`codemap.audit.<key>-added`), one result per `added` row at severity `warning`. Mirrors the `cmd-index.ts ↔ application/index-engine.ts` seam — CLI parses + dispatches; engine does the diff. **`runAudit({db, baselines})`** iterates the per-delta baseline map; deltas absent from the map don't run. Each entry in **`V1_DELTAS`** pins a canonical SQL projection (`files`: `SELECT path FROM files`; `dependencies`: `SELECT from_path, to_path FROM dependencies`; `deprecated`: `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%'`) plus a `requiredColumns` list. **`computeDelta`** validates baseline column-set membership, projects baseline rows down to the canonical column subset (extras dropped — schema-drift-resilient), runs the canonical SQL via the caller's DB connection, and set-diffs via the existing **`src/diff-rows.ts`** multiset helper (shared with `query --baseline`). Each emitted delta carries its own **`base`** metadata so mixed-baseline audits (e.g. `--baseline base --dependencies-baseline override`) are first-class. **`runAuditCmd`** runs an auto-incremental-index prelude (`runCodemapIndex({mode: "incremental", quiet: true})`) before the diff so `head` reflects the current source — `--no-index` opts out for frozen-DB CI scenarios. **`resolveAuditBaselines({db, baselinePrefix, perDelta})`** composes the baseline map: auto-resolves `<prefix>-<delta-key>` for slots that exist (silently absent otherwise) and lets per-delta flags override individual slots. v1 ships no `verdict` / threshold config / non-zero exit codes — consumers compose `--json` + `jq` for CI exit codes; v1.x still tracks `verdict` + an `audit` field on the config object (`.codemap/config.{ts,js,json}`) thresholds. **`--base <ref>` (shipped):** **`runAuditFromRef({db, ref, perDeltaOverrides, projectRoot, reindex})`** materialises the ref via **`application/audit-worktree.ts`** — `git rev-parse --verify "<ref>^{commit}"` → resolved sha → cache lookup at `<projectRoot>/.codemap/audit-cache/<sha>/`. Cache miss: per-pid temp dir (`.tmp.<sha>.<pid>.<ts>`) gets `git worktree add --detach`, the injected `reindex` callback (`makeWorktreeReindex` in production — re-inits the runtime singletons against the worktree path, runs `runCodemapIndex({mode: "full"})`, restores) writes `.codemap/index.db` inside, then POSIX `rename` claims the final `<sha>/` slot. **Atomic populate** — concurrent processes resolving the same sha race-safely without lock files (loser's rename fails with EEXIST → falls through to cache hit). Eviction: hardcoded LRU 5 entries / 500 MiB; `git worktree remove --force` then `rm -rf` for each victim; orphan `.tmp.*` dirs older than 10 min get swept too. Per-delta `base` metadata gains a discriminator: existing baseline-source remains `{source: "baseline", name, sha, indexed_at}`; new ref-source is `{source: "ref", ref, sha, indexed_at}`. `--base` is mutually exclusive with `--baseline <prefix>` (parser + handler both guard); composes orthogonally with per-delta `--<key>-baseline name` overrides. Hard error on non-git projects (`existsSync(<root>/.git)` check before any spawn). All git spawns in `audit-worktree.ts` strip inherited `GIT_*` env vars so a containing git operation (e.g. running codemap inside a husky hook) doesn't route worktree calls at the wrong index.

**PR-comment wiring:** **`src/cli/cmd-pr-comment.ts`** (argv — `<input-file>` (or `-` for stdin) + `--shape audit|sarif` + `--json`) + **`src/application/pr-comment-engine.ts`** (engine — `renderAuditComment` / `renderSarifComment` / `detectCommentInputShape`). Renders an audit-JSON envelope or SARIF doc as a markdown PR-summary comment; designed for surfaces SARIF→Code-Scanning doesn't cover (private repos without GHAS, aggregate audit deltas without `file:line` anchors, bot-context seeding). Output: bare markdown by default; `--json` envelope `{markdown, findings_count, kind}` for action.yml steps. Audit-mode groups by delta with `<details>` sections (added + removed); SARIF-mode groups by `ruleId`. Lists >50 entries collapse to `… and N more`. v1.0 ships the (b) summary-comment shape; (c) inline-review comments deferred per Q4 of [`plans/github-marketplace-action.md`](./plans/github-marketplace-action.md).

**Context wiring:** **`src/cli/cmd-context.ts`** (argv + render) + **`src/application/context-engine.ts`** (engine — **`buildContextEnvelope`**, **`classifyIntent`**, `ContextEnvelope` type). `buildContextEnvelope` composes the JSON envelope from existing recipes (`fan-in` for `hubs`, `markers` SELECT for `sample_markers`, `QUERY_RECIPES` map for the catalog). **`classifyIntent`** maps `--for "<text>"` to one of `refactor | debug | test | feature | explore | other` via regex against the trimmed input; whitespace-only intents are rejected. `--compact` drops `hubs` + `sample_markers` and emits one-line JSON; otherwise pretty-prints with 2-space indent.

**Impact wiring:** **`src/cli/cmd-impact.ts`** (argv — `<target>` + `--direction up|down|both` + `--depth N` + `--via dependencies|calls|imports|all` + `--limit N` + `--summary` + `--json`; bootstrap absorbs `--root`/`--config`) + **`src/application/impact-engine.ts`** (engine — `findImpact({db, target, direction?, via?, depth?, limit?})`). Pure transport-agnostic walker over the calls + dependencies + imports graphs; CLI / MCP / HTTP all dispatch the same engine function via `tool-handlers.ts`'s `handleImpact`. Target auto-resolves: contains `/` or matches `files.path` → file target; otherwise symbol (case-sensitive). Walks compatible backends per resolved kind: **symbol** → `calls` (callers / callees by `caller_name` / `callee_name`); **file** → `dependencies` (`from_path` / `to_path`) + `imports` (`file_path` / `resolved_path`, `IS NOT NULL` filter). `--via <b>` overrides; mismatched explicit choices land in `skipped_backends` (no error — agents see why their backend selection yielded fewer rows than expected). One `WITH RECURSIVE` per (direction, backend) combo with cycle detection via path-string `instr` check (SQLite has no native cycle predicate); JS-side merge + dedup by `(direction, kind, name?, file_path)` keeping the shallowest depth. `--depth 0` uses an unbounded sentinel (`UNBOUNDED_DEPTH_SENTINEL = 1_000_000`); cycle detection + `LIMIT` keep cyclic graphs cheap regardless. Termination reason classification: `limit` (truncated) > `depth` (any node sat at the cap) > `exhausted`. Result envelope: `{target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by}, skipped_backends?}`. `--summary` blanks `matches` (transport bandwidth saver) but preserves `summary.nodes` so CI gates (`jq '.summary.nodes'`) still see the count. SARIF / annotations not supported (graph traversal, not findings — the parser accepts the flag combos but the engine only emits JSON).

**Show / snippet wiring:** **`src/cli/cmd-show.ts`** + **`src/cli/cmd-snippet.ts`** — sibling CLI verbs sharing the same parser shape (`<name>` + `--kind` + `--in <path>` + `--json`) and the pure engine **`src/application/show-engine.ts`** (`findSymbolsByName({db, name, kind?, inPath?})` for the lookup; `readSymbolSource({match, projectRoot, indexedContentHash?})` + `getIndexedContentHash(db, filePath)` for the snippet-side FS read; **`buildShowResult`** + **`buildSnippetResult`** envelope builders — same engine the MCP show/snippet tools call). Both verbs return the same `{matches, disambiguation?}` envelope per plan § 4 uniformity — single match → `{matches: [{...}]}`; multi-match adds `{n, by_kind, files, hint}`. Snippet matches add `source` / `stale` / `missing` fields (additive — no shape divergence). **`--in <path>`** is normalized through `toProjectRelative(projectRoot, p)` (from **`src/application/validate-engine.ts`**) so `--in ./src/cli/`, `--in src/cli`, and `--in src/cli/cmd-show.ts` all resolve identically. Stale-file behavior on `snippet`: `hashContent` (from **`src/hash.ts`** — same primitive `cmd-validate.ts` uses) compares the on-disk content_hash against `files.content_hash`; mismatch sets `stale: true` but the source IS still returned (read tool, no auto-reindex side-effects). MCP tools `show` and `snippet` register parallel to the CLI surface (see [§ MCP wiring](#cli-usage)).

**Recipes wiring:** **`src/application/recipes-loader.ts`** (pure transport-agnostic loader) + **`src/application/query-recipes.ts`** (cache + public API — `getQueryRecipeSql` / `getQueryRecipeActions` / `getQueryRecipeParams` / `listQueryRecipeIds` / `listQueryRecipeCatalog` / `getQueryRecipeCatalogEntry`, shared by CLI + MCP). Recipes live as file pairs: **`<id>.sql`** + optional **`<id>.md`**. The loader reads `templates/recipes/` (bundled, ships in npm package next to `templates/agents/`) and `<projectRoot>/.codemap/recipes/` (project-local — root-only resolution per the registry plan, no walk-up). Project recipes win on id collision; entries that override a bundled id carry **`shadows: true`** in the catalog so agents reading `codemap://recipes` at session start see when a recipe behaves differently from the documented bundled version. Per-row **`actions`** templates and recipe **`params`** declarations live in YAML frontmatter on each `<id>.md` — uniform shape across bundled + project. Param types are `string | number | boolean`; CLI passes values via repeatable `--params key=value[,key=value]`, MCP / HTTP pass nested `params: {key: value}` to `query_recipe`. Validation runs before SQL binding; missing / unknown / malformed params return the same `{error}` envelope as query failures. Hand-rolled YAML parser is scoped to block-list `actions:` and `params:` only (no `js-yaml` dep). Load-time validation rejects empty SQL and DML / DDL keywords (`INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `ALTER` / `ATTACH` / `DETACH` / `REPLACE` / `TRUNCATE` / `VACUUM` / `PRAGMA`) with recipe-aware error messages — defence in depth alongside the runtime `PRAGMA query_only=1` backstop in `query-engine.ts` (PR #35). `.codemap/index.db` is gitignored; `.codemap/recipes/` is NOT (verified via `git check-ignore`) — recipes are git-tracked source code authored for human review.

**Tool / resource handlers (transport-agnostic):** **`src/application/tool-handlers.ts`** + **`src/application/resource-handlers.ts`** — pure functions that take the args object an MCP tool / resource URI accepts and return a discriminated **`ToolResult`** (`{ok: true, format: 'json'|'sarif'|'annotations', payload}` / `{ok: false, error}`) or a **`ResourcePayload`** (`{mimeType, text}`). MCP and HTTP both wrap the same handlers — MCP translates to `{content: [{type: "text", text}]}`, HTTP translates to `(status, body)` with the right `Content-Type`. Engine layer untouched; transport changes don't ripple into the SQL.

**MCP wiring:** **`src/cli/cmd-mcp.ts`** (argv — `--help` only; bootstrap absorbs `--root`/`--config`) + **`src/application/mcp-server.ts`** (transport — tool / resource registry, SDK glue). Mirrors the `cmd-audit.ts ↔ audit-engine.ts` seam — CLI parses + lifecycle; engine owns the SDK. **`runMcpServer`** bootstraps codemap once at server boot (config + resolver + DB access become module-level state), instantiates `McpServer` from **`@modelcontextprotocol/sdk`**, attaches a **`StdioServerTransport`**, and resolves when stdin closes (clean shutdown). Tool handlers reuse the existing engine entry-points: **`query`** + **`query_recipe`** call **`executeQuery`** in **`src/application/query-engine.ts`** (a pure transport-agnostic engine extracted from `printQueryResult`'s JSON branch — same `[...rows]` / `{count}` / `{group_by, groups}` envelope `--json` would print); **`query_batch`** loops via **`executeQueryBatch`** with batch-wide-defaults + per-statement-overrides (items are `string | {sql, summary?, changed_since?, group_by?}`); **`audit`** runs `resolveAuditBaselines` + `runAudit` from PR #33 unchanged; **`context`** / **`validate`** call `buildContextEnvelope` / `computeValidateRows` from **`src/application/context-engine.ts`** + **`src/application/validate-engine.ts`** (lifted out of `src/cli/cmd-*.ts` in PR #41 — see § Tool / resource handlers above). **`save_baseline`** is one polymorphic tool (`{name, sql? | recipe?}`) with a runtime exclusivity check — mirrors the CLI's single `--save-baseline=<name>` verb. **Tool naming**: snake_case throughout — Codemap convention matching the patterns in MCP spec examples and reference servers (GitHub MCP, Cursor built-ins); the spec itself doesn't mandate it. CLI stays kebab — translation lives at the MCP-arg layer. **Resources** (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`) use **lazy memoisation** — first `read_resource` populates a per-server-instance cache; constant for the server-process lifetime so eager-vs-lazy produce identical observable behavior. `codemap://schema` queries `sqlite_schema` live; `codemap://skill` reads from `resolveAgentsTemplateDir() + skills/codemap/SKILL.md`. Output shape uniformity (plan § 4): every tool returns the JSON envelope its CLI counterpart's `--json` flag prints, surfaced via `content: [{type: "text", text: JSON.stringify(payload)}]`. `--changed-since` git lookups are memoised per `(root, ref)` pair across batch items so a `query_batch` of N items sharing the same ref does one git invocation, not N. Per-statement errors in `query_batch` are isolated — failed statements return `{error}` in their slot while siblings still execute.

**HTTP wiring:** **`src/cli/cmd-serve.ts`** (argv — `--host` / `--port` / `--token`; bootstrap absorbs `--root`/`--config`) + **`src/application/http-server.ts`** (transport — bare `node:http`; routes `POST /tool/{name}` to `tool-handlers`, `GET /resources/{encoded-uri}` to `resource-handlers`, plus `GET /health` / `GET /tools` / `GET /resources`). Default bind **`127.0.0.1:7878`** (loopback only — refuse `0.0.0.0` unless explicitly opted in via `--host 0.0.0.0`). Optional **`--token <secret>`** requires `Authorization: Bearer <secret>` on every request; `GET /health` is auth-exempt so liveness probes work without leaking the token. **CSRF + DNS-rebinding guard** (`csrfCheck`) runs before every route — rejects `Sec-Fetch-Site: cross-site` / `same-site` (modern-browser CSRF), any `Origin` header that isn't `null` (older-browser CSRF), and `Host` header mismatch on loopback bind (DNS rebinding). Non-browser clients (curl, fetch from Node, MCP hosts, CI scripts) don't send those headers and pass through. The guard runs even on `/health` so a malicious local webpage can't probe for liveness. Output shape uniformity (plan § D5): every tool returns the same `codemap query --json` envelope (NOT MCP's `{content: [...]}` wrapper — HTTP doesn't need that transport artifact); `format: "sarif"` payloads ship as `application/sarif+json`, `format: "annotations"` / `"mermaid"` / `"diff"` as `text/plain; charset=utf-8`, `format: "diff-json"` as `application/json; charset=utf-8`, JSON otherwise. Per-request DB lifecycle: open / `PRAGMA query_only = 1` / close per call (SQLite reader concurrency); 1 MiB request-body cap rejects trivial DoS. SIGINT / SIGTERM → graceful drain via `server.close()`. Every response carries **`X-Codemap-Version: <semver>`** so consumers can pin / detect upgrades.

**Watch wiring:** **`src/cli/cmd-watch.ts`** (argv — `--debounce <ms>` / `--quiet`; bootstrap absorbs `--root`/`--config`) + **`src/application/watcher.ts`** (engine — pure debouncer + glob filter + injectable backend; production wires [chokidar v5](https://github.com/paulmillr/chokidar) selected via the 6-watcher audit in PR #46 — pure JS, runs identically on Bun + Node, ~30M repos use it). On every change/add/unlink event chokidar emits, the engine filters via `shouldIndexPath` (same indexed extensions as the indexer + project-local recipes; skips `node_modules` / `.git` / `dist`), debounces with a sliding window (default 250 ms), then calls `createReindexOnChange` which opens a DB, runs `runCodemapIndex({mode: 'files', files: [...changed]})`, closes the DB, and logs `reindex N file(s) in Mms` to stderr unless `--quiet`. SIGINT / SIGTERM drains pending edits via `flushNow()` before the watcher closes. **Default-ON for `mcp` / `serve` since 2026-05:** both transports boot the watcher in-process so every tool reads a live index — eliminates the per-request reindex prelude. Opt out with `--no-watch` or `CODEMAP_WATCH=0` (`CODEMAP_WATCH=1` still parses for backwards-compat but is now a no-op since it matches the default). Standalone `codemap watch` runs the watcher decoupled from a transport for users wiring it next to a separate MCP / HTTP process. **Audit prelude optimization:** module-level `watchActive` flag; `handleAudit` skips its incremental-index prelude when active (and marks the close as readonly to avoid a wasted checkpoint). Explicit `no_index: false` still forces the prelude.

**Performance wiring:** **`--performance`** plumbs through **`RunIndexOptions.performance`** → **`indexFiles({ performance, collectMs })`**. `parse-worker-core.ts` records per-file **`parseMs`** on each `ParsedFile`; main thread times the four phases (`collect`, `parse`, `insert`, `index_create`) and assembles **`IndexPerformanceReport`** under `IndexRunStats.performance`. Note: `total_ms` is `indexFiles` wall-clock, **not** end-to-end run wall — `collect_ms` happens before `indexFiles` and is reported separately.

**Agent templates:** `codemap agents init` — full matrix [agents.md](./agents.md).

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

Current schema version: **10** — see [Schema Versioning](#schema-versioning) for details.

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
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------- |
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
| complexity        | REAL       | Cyclomatic complexity (McCabe; `1 + decision points`) for function-shaped symbols only. NULL for non-functions (interfaces, types, enums, plain consts) and class methods (v1 limitation). Decision points: `if`, `while`, `do…while`, `for`, `for…in`, `for…of`, `case X:` arms (not `default:`), short-circuit `&&` / `                                          |     | `/`??`, ternary `?:`, and `catch`clauses. Powers the`high-complexity-untested` recipe |

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

Two write sites both call `recordRecipeRun` from `application/recipe-recency.ts`: `handleQueryRecipe` in `application/tool-handlers.ts` (covers MCP + HTTP — both flow through it) and `runQueryCmd` in `cli/cmd-query.ts` (CLI — finally-block observes `process.exitCode` as the unified success signal). Counts only successful runs; recency-write failures are swallowed with a stderr `[recency] write failed: <reason>` warning so they NEVER block the recipe response. The 90-day rolling window is enforced lazily on `--recipes-json` reads (no DELETE on the write path).

Default ON; opt-out via `.codemap/config` `recipe_recency: false` (short-circuits before any DB write — no rows ever land). `recipe_id` is loose — matches bundled or project-recipe ids (no `recipes` SQLite table to FK against; project-shadow rows share the bundled row per Q4 of the recipe-recency plan).

| Column      | Type    | Description                                                                              |
| ----------- | ------- | ---------------------------------------------------------------------------------------- |
| recipe_id   | TEXT PK | Recipe id (matches `QUERY_RECIPES` keys + project-recipe ids in `<state-dir>/recipes/`). |
| last_run_at | INTEGER | Epoch ms of the last successful run.                                                     |
| run_count   | INTEGER | Cumulative successful runs (incremented per call). `INTEGER` wraparound is theoretical.  |

`idx_recipe_recency_last_run` on `last_run_at` keeps the lazy 90-day prune (`DELETE WHERE last_run_at < cutoffMs`) an indexed scan as project-recipe counts grow. Boundary discipline: only `application/tool-handlers.ts` + `cli/cmd-query.ts` (+ the test file) may import `recordRecipeRun` — verifiable via the forbidden-edge query in the engine module's docstring.

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

## File Artifacts

Running the indexer produces up to three files in the project root, all gitignored:

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
