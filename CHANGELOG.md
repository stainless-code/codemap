# @stainless-code/codemap

## 0.5.0

### Minor Changes

- [#35](https://github.com/stainless-code/codemap/pull/35) [`119db38`](https://github.com/stainless-code/codemap/commit/119db38670ab007a6367556d844e3c1103dc450e) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(mcp): `codemap mcp` — Model Context Protocol server (agent-transports v1)

  Adds the `codemap mcp` top-level command — boots an MCP server over
  stdio so agent hosts (Claude Code, Cursor, Codex, generic MCP clients)
  call codemap as JSON-RPC tools instead of shelling out per query.
  Eliminates the bash round-trip on every agent invocation.

  Surface (one tool per CLI verb plus `query_batch`, all snake_case):
  - `query`, `query_batch`, `query_recipe`, `audit`, `save_baseline`,
    `list_baselines`, `drop_baseline`, `context`, `validate`
  - Resources: `codemap://recipes`, `codemap://recipes/{id}`,
    `codemap://schema`, `codemap://skill` (lazy-cached)

  `query_batch` is MCP-only — N statements in one round-trip with
  batch-wide-defaults + per-statement-overrides (items are
  `string | {sql, summary?, changed_since?, group_by?}`). Per-statement
  errors are isolated. `save_baseline` ships as one polymorphic tool
  (`{name, sql? | recipe?}` with runtime exclusivity check) mirroring
  the CLI's single `--save-baseline=<name>` verb.

  Output shape is verbatim from each tool's CLI counterpart's `--json`
  envelope (no re-mapping). Bootstrap once at server boot; tool
  handlers reuse existing engine entry-points (`executeQuery`,
  `runAudit`, etc.) — no duplicate business logic.

  New dep: `@modelcontextprotocol/sdk`.

  HTTP API (`codemap serve`) stays in roadmap backlog; design points
  (tool taxonomy + output shape) are reserved in `docs/architecture.md
§ MCP wiring` so HTTP inherits them when a concrete consumer asks.

- [#74](https://github.com/stainless-code/codemap/pull/74) [`7889fed`](https://github.com/stainless-code/codemap/commit/7889fedfff865dc71accf35169a2d5a7b40681e2) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap audit --format <text|json|sarif>` — emit a SARIF 2.1.0 doc directly from the audit envelope, no JSON→SARIF transform step needed. One rule per delta key (`codemap.audit.files-added`, `codemap.audit.dependencies-added`, `codemap.audit.deprecated-added`); one result per `added` row; severity = `warning` (audit deltas are more actionable than per-recipe `note`). Locations auto-detected via the same `file_path` / `path` / `to_path` / `from_path` priority list that `query --format sarif` uses; line ranges (`line_start` / `line_end`) populate the SARIF `region`. Pure output-formatter addition on top of the existing audit envelope; no schema impact.

  `--json` stays as the shortcut for `--format json` (backward-compatible). `--json` + `--format <other>` rejected as a contradiction. `--summary` is a no-op with `--format sarif` (SARIF results are per-row, not counts) and surfaces a stderr warning.

  `removed` rows are intentionally excluded from SARIF output — SARIF surfaces findings to act on, not cleanups. Location-only rows (e.g. files-added has only `path`) get a "new files: src/foo.ts" message instead of the generic "(no message)" fallback.

  This is the first half of Slice 1 from the [GitHub Marketplace Action plan](../docs/plans/github-marketplace-action.md) — independently useful for any CI consumer running `codemap audit` who wants Code Scanning surface without a translation layer; required for the upcoming Marketplace Action's headline default command.

- [#72](https://github.com/stainless-code/codemap/pull/72) [`2c3045d`](https://github.com/stainless-code/codemap/commit/2c3045dda0103fa14bb8bfb27352fc11efa1eec6) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(boundaries): config-driven architecture-boundary rules + `boundary-violations` recipe

  Adds the smallest substrate for first-class architecture boundary checks. Schema bump 8 → 9.

  **Configure**

  ```ts
  import { defineConfig } from "@stainless-code/codemap";

  export default defineConfig({
    boundaries: [
      {
        name: "ui-cant-touch-server",
        from_glob: "src/ui/**",
        to_glob: "src/server/**",
      },
    ],
  });
  ```

  `action` defaults to `"deny"` (the only shape v1 surfaces); `"allow"` reserves the slot for future whitelist semantics.

  **Substrate**
  - New config field `boundaries: BoundaryRule[]` on the Zod user-config schema (`src/config.ts`); validated at config-load time.
  - New table `boundary_rules(name PK, from_glob, to_glob, action CHECK IN ('deny','allow'))` (`STRICT, WITHOUT ROWID`) — fully derived from config, dropped on `--full` / `SCHEMA_VERSION` rebuilds and re-filled by the next index pass.
  - New helper `reconcileBoundaryRules(db, rules)` in `src/db.ts`; called from `runCodemapIndex` after `createSchema` so the table tracks config exactly.
  - New runtime accessor `getBoundaryRules()`.

  **Recipe**

  `templates/recipes/boundary-violations.{sql,md}` joins `dependencies` × `boundary_rules` via SQLite `GLOB` and surfaces violating import edges as locatable rows. `--format sarif` and `--format annotations` light up automatically (the recipe aliases `dependencies.from_path` to `file_path`). Use as a CI gate:

  ```bash
  codemap query --recipe boundary-violations --format sarif > findings.sarif
  ```

  **Lockstep**
  - `docs/architecture.md` § Schema gains a `boundary_rules` subsection.
  - `docs/glossary.md` adds `boundaries` / `boundary_rules` / `boundary-violations` entry.
  - `docs/roadmap.md § Backlog` removes the now-shipped item per Rule 2.
  - `templates/agents/rules/codemap.md`, `.agents/rules/codemap.md`, `templates/agents/skills/codemap/SKILL.md`, `.agents/skills/codemap/SKILL.md`, and `README.md` all document the new shape.

  **Tests**

  `src/application/boundary-rules.test.ts` covers schema creation, idempotent reconciliation, CHECK constraint, and the recipe SQL against a synthetic dependency graph. `src/config.test.ts` covers Zod validation including default-action filling and unknown-action rejection.

- [#52](https://github.com/stainless-code/codemap/pull/52) [`fe5a355`](https://github.com/stainless-code/codemap/commit/fe5a3551bb9abd91021a8a0e021cbcd42c44234f) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap audit --base <ref>` — ad-hoc structural-drift audit against any git committish (`origin/main`, `HEAD~5`, `<sha>`, tag, …). Closes the highest-frequency post-watch agent loop: "what changed structurally between this branch and `origin/main`?". Replaces today's 3-step `--baseline` dance (switch branches, reindex, save baselines, switch back) with one verb.

  **Three transports, one engine:**
  - **CLI:** `codemap audit --base <ref> [--<delta>-baseline <name>] [--summary] [--json] [--no-index]`
  - **MCP tool:** `audit` with new `base?: string` arg
  - **HTTP:** `POST /tool/audit` (auto-wired via the existing dispatcher)

  All three dispatch the same pure `runAuditFromRef` engine in `application/audit-engine.ts`.

  **How it works:**
  1. `git rev-parse --verify "<ref>^{commit}"` resolves `<ref>` to a sha (clean error on non-git or unresolvable ref).
  2. Cache lookup at `<projectRoot>/.codemap/audit-cache/<sha>/.codemap.db`. Hit → sub-100ms; miss → continue.
  3. **Atomic populate** — `git worktree add` to a per-pid temp dir + `runCodemapIndex({mode: "full"})` against the worktree's `.codemap.db` + POSIX `rename` claims the final `<sha>/` slot. Concurrent CI matrix runs against the same sha race-safely without lock files (loser's rename fails with EEXIST → falls through to cache hit).
  4. Run each delta's canonical SQL on the cached DB vs the live DB; `diffRows` (existing helper) computes `{added, removed}`.
  5. Compose `AuditEnvelope` with per-delta `base.source: "ref"` (new value) + `base.ref` (user-supplied string) + `base.sha` (resolved).

  **Decisions worth knowing:**
  - **`AuditBase` is now a discriminated union** — existing `{source: "baseline", name, sha, indexed_at}` rows untouched; new `{source: "ref", ref, sha, indexed_at}` arm. Consumers narrowing on `base.source` keep compiling.
  - **Mutually exclusive with `--baseline <prefix>`.** Parser + handler both guard. Per-delta `--<key>-baseline` overrides compose orthogonally with both, so `--base origin/main --files-baseline pre-refactor-files` is valid (mixed sources).
  - **Eviction:** hardcoded LRU 5 entries / 500 MiB; `git worktree remove --force` + `rm -rf` for each victim. Orphan `.tmp.*` dirs older than 10 min get swept on the next cycle. No config knobs in v1; defer to v1.x+ if real consumers ask.
  - **Hard error on non-git projects.** No graceful fallback — there's no meaningful "ref" without git. The other audit modes (`--baseline`, `--<delta>-baseline`) still work without git.
  - **Env hygiene.** All git spawns in `audit-worktree.ts` strip inherited `GIT_*` env vars so a containing git operation (e.g. running codemap from a husky hook) doesn't route worktree calls at the wrong index.

  **Auto-`.gitignore`:** `codemap agents init` now adds `.codemap/audit-cache/` alongside `.codemap.*` so cached worktrees never get committed. `.codemap/recipes/` stays git-tracked.

  Plan: PR [#51](https://github.com/stainless-code/codemap/issues/51) (merged). Implementation: PR [#52](https://github.com/stainless-code/codemap/issues/52).

- [#54](https://github.com/stainless-code/codemap/pull/54) [`1313fc2`](https://github.com/stainless-code/codemap/commit/1313fc2bb5092b175376be4b3db529bed098cece) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `.codemap/` directory consolidation + self-healing files. Every codemap-managed path lives under a single configurable state directory (default `.codemap/`, override via `--state-dir <path>` or `CODEMAP_STATE_DIR`). Cleans up the dual-pattern surface (`<root>/.codemap.db` + `<root>/.codemap/<thing>/`) that's been growing with every cache PR; collapses the user `.gitignore` patching surface to zero.

  **New layout:**

  ```
  <root>/
  └── .codemap/                 ← override via --state-dir / CODEMAP_STATE_DIR
      ├── .gitignore            ← codemap-managed (self-healing); tracked
      ├── config.{ts,js,json}   ← was <root>/codemap.config.*; tracked
      ├── recipes/              ← user-authored SQL; tracked (existing)
      ├── index.db              ← was .codemap.db
      ├── index.db-shm          ← was .codemap.db-shm
      ├── index.db-wal          ← was .codemap.db-wal
      └── audit-cache/          ← was .codemap/audit-cache/ (existing)
  ```

  **Self-healing files (D11):** `<state-dir>/.gitignore` and `<state-dir>/config.json` are owned by idempotent `ensure*` reconcilers (`src/application/state-dir.ts`, `src/application/state-config.ts`) that run on every codemap boot — read → validate → reconcile → write only on drift. **The setup logic IS the migration**: future codemap versions add new generated artifacts to `STATE_GITIGNORE_BODY` (or extend the Zod schema), and every consumer's project repairs itself on the next `codemap` invocation. No more per-feature `.gitignore` patching in `agents-init.ts`.

  **Pre-v1 — no migration shim:**
  - `<root>/.codemap.db` → `<state-dir>/index.db` (rename basename)
  - `<root>/codemap.config.{ts,json}` → `<state-dir>/config.{ts,js,json}` (move file)
  - Existing dev clones: `rm .codemap.db .codemap.db-shm .codemap.db-wal` once and re-index; move `codemap.config.*` into `.codemap/` (or set `--config <old-path>` to keep using the legacy location explicitly).

  **New flags + env:**
  - `--state-dir <path>` — override the state directory (resolves relative to project root).
  - `CODEMAP_STATE_DIR` — same, env-var form.

  **Internal refactor:** new `src/cli/bootstrap-codemap.ts` extracts the `loadUserConfig + resolveCodemapConfig + initCodemap + configureResolver` dance from 9 cmd-\* files into one helper that also runs the self-healing reconcilers. Adding a new self-healing file is now a one-line addition there.

  Inspired by flowbite-react's `.flowbite-react/.gitignore` + `setup-*` pattern; expressed in codemap's own conventions (`ensure*` reconcilers, Zod schema as `z.infer` source of truth, pure `{before, after, written}` return shapes for testability).

  Plan: PR [#53](https://github.com/stainless-code/codemap/issues/53) (merged). Implementation: PR [#54](https://github.com/stainless-code/codemap/issues/54).

- [#50](https://github.com/stainless-code/codemap/pull/50) [`90092ae`](https://github.com/stainless-code/codemap/commit/90092ae51fc8d88e825cdd931bc3fb4bd9c9f047) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap impact <target>` — symbol/file blast-radius walker. Replaces hand-composed `WITH RECURSIVE` queries that agents struggle to write reliably with a single verb that walks the calls / dependencies / imports graphs (callers, callees, dependents, dependencies). Depth- and limit-bounded, cycle-detected.

  **Three transports, one engine:**
  - **CLI:** `codemap impact <target> [--direction up|down|both] [--depth N] [--via dependencies|calls|imports|all] [--limit N] [--summary] [--json]`
  - **MCP tool:** `impact` (registered alongside `show` / `snippet`)
  - **HTTP:** `POST /tool/impact`

  All three dispatch the same pure `findImpact` engine in `application/impact-engine.ts` per the post-PR [#41](https://github.com/stainless-code/codemap/issues/41) layering — adding tools never duplicates business logic.

  **Decisions worth knowing:**
  - **Target auto-resolution.** Contains `/` or matches `files.path` → file target; otherwise symbol (case-sensitive, exact). Symbol targets walk `calls`; file targets walk `dependencies` + `imports` (`resolved_path` only). Mismatched explicit `--via` choices land in `skipped_backends` (no error — agent sees why their selection yielded fewer rows than expected).
  - **Cycle detection.** SQLite has no native cycle predicate; we materialise a comma-bounded path string per row and `instr` it to break re-entry. Bounded depth + `--limit` (default 500) keep cyclic graphs cheap regardless. `--depth 0` walks unbounded but stays cycle-detected and limit-capped.
  - **Termination classification.** `summary.terminated_by`: `limit` > `depth` > `exhausted`. CI gates can branch on it.
  - **`--summary` shape.** Trims the `matches` array but preserves `summary.nodes` — the `jq '.summary.nodes'` consumption pattern still works.
  - **No SARIF / annotations.** Impact rows are graph traversals, not findings — wrong shape for those formats.

  **Engine sketch:** one `WITH RECURSIVE` query per (direction, backend) combo, JS-side merge + dedup by `(direction, kind, name?, file_path)` keeping the shallowest depth, then `summary.by_kind` + `terminated_by` classification.

  Plan: PR [#49](https://github.com/stainless-code/codemap/issues/49) (merged). Implementation: PR [#50](https://github.com/stainless-code/codemap/issues/50).

- [#44](https://github.com/stainless-code/codemap/pull/44) [`4ec51d8`](https://github.com/stainless-code/codemap/commit/4ec51d857955e2a055471decf70cfd953e36a056) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap serve` — HTTP server exposing the same tool taxonomy as `codemap mcp` over `POST /tool/{name}`. For non-MCP consumers (CI scripts, simple `curl`, IDE plugins that don't speak MCP).

  Default bind `127.0.0.1:7878` (loopback only — refuse `0.0.0.0` unless explicitly opted in via `--host 0.0.0.0`). Optional `--token <secret>` requires `Authorization: Bearer <secret>` on every request; `GET /health` is auth-exempt so liveness probes work without leaking the token. Bare `node:http` (no Express / Fastify dep) — runs on Bun + Node.

  **Routes:**
  - `POST /tool/{name}` — every MCP tool (query, query_recipe, query_batch, audit, context, validate, show, snippet, save_baseline, list_baselines, drop_baseline). Body `{<args>}`; response = same `codemap query --json` envelope (NOT MCP's `{content: [...]}` wrapper). `format: "sarif"` payloads ship as `application/sarif+json`; `format: "annotations"` as `text/plain`.
  - `GET /resources/{encoded-uri}` — mirror of MCP resources (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`).
  - `GET /health` — liveness (auth-exempt); `GET /tools` / `GET /resources` — catalogs.
  - Errors: `{"error": "..."}` with HTTP status 400 / 401 / 404 / 500.
  - Every response carries `X-Codemap-Version: <semver>` so consumers can pin / detect upgrades.

  **Internals:** Tool bodies (`application/tool-handlers.ts`) and resource fetchers (`application/resource-handlers.ts`) are pure transport-agnostic — same handlers `codemap mcp` dispatches. No engine duplication; `mcp-server.ts` and `http-server.ts` both wrap the same `ToolResult` discriminated union.

  **Security:** CSRF + DNS-rebinding guard rejects requests with `Sec-Fetch-Site: cross-site` / `same-site` (modern-browser CSRF), any `Origin` header that isn't `null` (older-browser CSRF), and `Host` header mismatch on loopback bind (DNS rebinding) — runs on every request including auth-exempt `/health`. Defends against a malicious local webpage `fetch`-ing the API while the developer is browsing. Non-browser clients (curl, MCP hosts, CI scripts) don't send those headers and pass through. SIGINT / SIGTERM → graceful drain. 1 MiB request-body cap (DoS protection). SQLite reader concurrency handles parallel requests; `PRAGMA query_only = 1` set per connection.

- [#47](https://github.com/stainless-code/codemap/pull/47) [`5ef9ce4`](https://github.com/stainless-code/codemap/commit/5ef9ce4b398f60aa0e446dee5f8cc73e0978ae42) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap watch` — long-running process that re-indexes changed files in real time so every CLI / MCP / HTTP query reads live data without a per-query reindex prelude. Eliminates the single biggest source of agent-side friction: "is the index stale right now?"

  **Three shapes:**
  - **Standalone**: `codemap watch [--debounce 250] [--quiet]` — foreground process; logs `reindex N file(s) in Mms` per batch unless `--quiet`. SIGINT / SIGTERM drains pending edits.
  - **MCP killer combo**: `codemap mcp --watch [--debounce <ms>]` — boots stdio MCP server + watcher in one process. Long Cursor / Claude Code sessions never hit a stale index; agents stop having to remember to reindex between edit + query.
  - **HTTP killer combo**: `codemap serve --watch [--debounce <ms>]` — same shape for non-MCP consumers (CI scripts, IDE plugins, simple `curl`).

  **Audit prelude optimization:** when watch is active, `mcp audit`'s default incremental-index prelude becomes a no-op (the watcher already keeps the index fresh — saves the per-request reindex cost). Explicit `no_index: false` still forces the prelude.

  **Env shortcut:** `CODEMAP_WATCH=1` (or `"true"`) implies `--watch` for `mcp` / `serve` — useful for IDE / CI launches that can't easily edit the spawn command.

  **Backend:** [chokidar v5](https://github.com/paulmillr/chokidar) (selected via 6-watcher audit in PR [#46](https://github.com/stainless-code/codemap/issues/46)). Pure JS — runs identically on Bun + Node, no per-runtime branching, no native compile matrix on top of `bun:sqlite` / `better-sqlite3`. Cross-platform (macOS / Linux / Windows / WSL). Atomic-write + chunked-write detection out of the box. 1 dep (`readdirp`), 82 KB.

  **Filtering:** Only paths the indexer cares about trigger a reindex (TS / TSX / JS / JSX / CSS + project-local recipes under `<root>/.codemap/recipes/`). `node_modules` / `.git` / `dist` / configured `excludeDirNames` are skipped.

- [#57](https://github.com/stainless-code/codemap/pull/57) [`b5679a6`](https://github.com/stainless-code/codemap/commit/b5679a67de7b145c6b5937651d72f76bc6b1664c) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap ingest-coverage <path>` — static coverage ingestion. Reads Istanbul JSON (`coverage-final.json`) or LCOV (`lcov.info`) into a new `coverage` table joinable to `symbols`, so structural queries can compose coverage filters in pure SQL — no runtime tracer, no paid coverage stack.

  **Both formats land in v1** (Istanbul + LCOV) so every test runner is a first-class consumer on day one — `vitest --coverage`, `jest --coverage`, `c8`, `nyc` (Istanbul JSON), and `bun test --coverage` (LCOV) all work without waiting on a follow-up release.

  **Bundled recipes (auto-discovered, no opt-in needed):**
  - `untested-and-dead` — exported functions with no callers AND zero coverage; the killer recipe combining structural and runtime evidence axes.
  - `files-by-coverage` — files ranked ascending by statement coverage.
  - `worst-covered-exports` — top-20 worst-covered exported functions.

  Each recipe ships a frontmatter `actions` block so agents see per-row follow-up hints in `--json` output.

  **Schema:**
  - New `coverage` table with natural-key PK `(file_path, name, line_start)` — intentionally not a FK to `symbols.id` so coverage rows survive the `symbols` drop-recreate cycle on every `--full` reindex.
  - `idx_coverage_file_name` covers the typical join shape and the `GROUP BY file_path` scan used by the `files-by-coverage` recipe.
  - Three new `meta` keys (`coverage_last_ingested_at` / `_path` / `_format`) record ingest freshness.
  - `SCHEMA_VERSION` 5 → 6 — auto-rebuilds on next `codemap` run; the new table is empty until first `ingest-coverage` invocation. Subsequent bumps preserve coverage data via the `dropAll()` exclusion.

  **CLI:**

  ```bash
  codemap ingest-coverage coverage/coverage-final.json   # Istanbul (auto-detected)
  codemap ingest-coverage coverage/lcov.info             # LCOV (auto-detected)
  codemap ingest-coverage coverage --json                # directory probe (errors if both files present)

  codemap query --json --recipe untested-and-dead        # the killer query
  ```

  No `--source` flag — format is auto-detected from extension. No MCP / HTTP transport in v1 — coverage exposes as a SQL column, composable with every existing recipe and ad-hoc query through the existing `query` / `query_recipe` tools (no parallel surface).

  Plan: PR [#56](https://github.com/stainless-code/codemap/issues/56) (merged). Implementation: this PR.

- [#71](https://github.com/stainless-code/codemap/pull/71) [`fc6790b`](https://github.com/stainless-code/codemap/commit/fc6790ba5738fc284eaff1c8f11182ffd688c816) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(query): add `--format diff` and `--format diff-json`

  Adds transport-agnostic diff formatters for query row sets shaped as:

  ```sql
  SELECT
    'src/file.ts' AS file_path,
    42 AS line_start,
    'oldName' AS before_pattern,
    'newName' AS after_pattern
  ```

  - **`--format diff`** emits plain unified diff text, ready for `git apply --check`.
  - **`--format diff-json`** emits `{files, warnings, summary}` for agents that need structured hunks.
  - Source files are read at format time. If a file is missing or the indexed line no longer contains `before_pattern`, the formatter marks it `missing` / `stale` in `diff-json` and emits `# WARNING:` comments at the top of plain diff output.
  - Same formatter support is exposed through MCP / HTTP `format: "diff" | "diff-json"` on `query` and `query_recipe`.

  This is read-only preview infrastructure — codemap never writes files.

- [#74](https://github.com/stainless-code/codemap/pull/74) [`7889fed`](https://github.com/stainless-code/codemap/commit/7889fedfff865dc71accf35169a2d5a7b40681e2) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - GitHub Marketplace Action — Slices 1b-4 of [`docs/plans/github-marketplace-action.md`](../docs/plans/github-marketplace-action.md). v1.0 readiness; `action.yml` is now installable via `- uses: stainless-code/codemap@v1` once the corresponding tag is published.

  **`--ci` aggregate flag (Slice 1b)** on `query` + `audit`. Aliases `--format sarif` + `process.exitCode = 1` on findings/additions + suppresses no-locatable-rows stderr warning. Mutually exclusive with `--json` and `--format <other>`. Parser rejects contradictions with helpful errors.

  **`action.yml` + `scripts/detect-pm.mjs` (Slice 2).** Composite Action wrapping the codemap CLI. ~16 declarative inputs across 3 categories (where to run / what to run / what to do with output); Q1 resolution. Default α command on `pull_request` events: `audit --base ${{ github.base_ref }} --ci`; no-op on other events unless an explicit `command:` input is passed. Package-manager autodetection delegates to [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) (antfu/userquin, MIT, 0 transitive deps); CLI invocation resolution via the library's `'execute-local'` / `'execute'` intents.

  **`codemap pr-comment` (Slice 3).** New CLI verb that renders a markdown PR-summary comment from a codemap-audit-JSON envelope or a SARIF doc. Auto-detects input shape; `--shape audit|sarif` overrides. Reads from a file or stdin (`-`). `--json` envelope emits `{ markdown, findings_count, kind }` for action.yml steps. Closes the SARIF→Code-Scanning gap for: private repos without GHAS, repos that haven't enabled Code Scanning, aggregate audit deltas without a single file:line anchor, trend / delta narratives, and bot-context seeding (review bots read PR conversation, not workflow artifacts). v1.0 ships the (b) summary-comment shape per Q4 resolution; (c) inline-review comments deferred to v1.x.

  **Dogfood (Slice 4).** New `action-smoke` job in `.github/workflows/ci.yml` runs `uses: ./` on every PR with `command: --version` to validate the composite-step flow + npm-pulled codemap binary. Non-blocking until v1.0.0 ships (at which point the smoke gates the build).

  **Engine + CLI separation discipline preserved:** `pr-comment-engine.ts` is pure; `cmd-pr-comment.ts` wraps it. Tests cover the engine (12 cases) and the CLI parser (4 audit + 4 query tests for `--ci`).

  **Lockstep agent updates** (per `docs/README.md` Rule 10): `.agents/rules/codemap.md` + `templates/agents/rules/codemap.md` gain rows for `--ci` and `pr-comment` so installed agents and this clone's session view stay in lockstep.

  Slice 5 (Marketplace publish + listing metadata) is post-merge — gated on a v1.0.0 tag.

- [`31479a5`](https://github.com/stainless-code/codemap/commit/31479a5154c1001f0a2371ff16287126cbe4c9bc) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(mcp/serve): default-ON watcher for `codemap mcp` and `codemap serve`

  Stale-index friction is empirically the most-frequent agent UX issue under `codemap mcp` (driving the watch-mode planning in PR [#46](https://github.com/stainless-code/codemap/issues/46)) and the most-frequent CI/IDE-plugin friction under `codemap serve`. Both modes are inherently long-running, so the chokidar co-process pays for itself immediately. Decision originally resolved 2026-05 (research note `§ 6 Q1`); this PR ships it.

  **New defaults.**
  - `codemap mcp` — watcher boots automatically; tools always read a live index.
  - `codemap serve` — same.
  - One-shot CLI defaults preserved: `codemap query` / `codemap show` / `codemap snippet` / etc. still spawn no watcher.

  **Opt out.**
  - `--no-watch` flag (new) — explicit opt-out for ephemeral-index workflows, fire-and-forget CI scripts, etc.
  - `CODEMAP_WATCH=0` / `CODEMAP_WATCH="false"` — env-shortcut mirroring `--no-watch` for IDE / CI launches that can't easily edit the spawn command.

  **Backwards-compat preserved.**
  - `--watch` flag still parses and is honored (no-op since it matches the new default; kept so existing scripts and launch commands don't break).
  - `CODEMAP_WATCH=1` / `CODEMAP_WATCH="true"` still parses (redundant after the flip, kept for backwards-compat).
  - `--no-watch` wins over `--watch` when both passed (last-write semantics).

  **Tradeoffs accepted.**
  - Slightly slower mcp/serve startup (~chokidar boot cost, validated tiny on Bun + Node by PR [#46](https://github.com/stainless-code/codemap/issues/46)'s 6-watcher audit).
  - Spawns a second process — visible to users running `htop` / `Activity Monitor`. Worth it for the live-index correctness gain.

  **Tests:** 12 new tests across `cmd-mcp.test.ts` and `cmd-serve.test.ts` cover default-ON behavior, `--no-watch` opt-out, env opt-out (`CODEMAP_WATCH=0` / `"false"`), env opt-in still honored (`CODEMAP_WATCH=1`), and `--no-watch` wins over `--watch`.

  **Lockstep updates:** `templates/agents/rules/codemap.md`, `templates/agents/skills/codemap/SKILL.md`, `.agents/rules/codemap.md`, `.agents/skills/codemap/SKILL.md`, and `README.md` all updated to reflect the new defaults + opt-out shape per `docs/README.md` Rule 10.

- [#71](https://github.com/stainless-code/codemap/pull/71) [`fc6790b`](https://github.com/stainless-code/codemap/commit/fc6790ba5738fc284eaff1c8f11182ffd688c816) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(recipes): parametrised recipe support + `find-symbol-by-kind`

  Recipes may now declare `params` in sibling `<id>.md` frontmatter and consume values through positional `?` placeholders in SQL. Values validate before SQL binding and support `string`, `number`, and `boolean` types.

  **CLI**
  - `codemap query --recipe <id> --params key=value[,key=value]`
  - `--params` may be repeated; duplicate keys use last-write semantics.
  - Values may contain `=` (split on first equals). Values containing literal commas should use repeated `--params`.
  - Param validation is strict: missing required, unknown, and malformed values return `{error}`.

  **MCP / HTTP**
  - `query_recipe` accepts `params: {key: value}`.
  - HTTP `POST /tool/query_recipe` uses the same shape.

  **Catalog**
  - `--recipes-json`, `codemap://recipes`, and `codemap://recipes/{id}` expose the `params` declaration for each parametrised recipe.

  **Example bundled recipe**
  - `find-symbol-by-kind` demonstrates the new path:
    `codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%`

  No schema bump. Runtime remains read-only via `PRAGMA query_only=1`; params are bound through SQLite placeholders, not string interpolation.

- [#30](https://github.com/stainless-code/codemap/pull/30) [`a309d52`](https://github.com/stainless-code/codemap/commit/a309d52d2527084348578d6c1278d7a7fc245108) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap query --save-baseline` / `--baseline` — snapshot a query result set and diff against it later. Stored in the new `query_baselines` table inside `.codemap.db` (no parallel JSON files). `--baselines` lists saved snapshots, `--drop-baseline <name>` deletes one. Diff identity is per-row `JSON.stringify` equality; `--summary` collapses to `{added: N, removed: N}`. Recipe `actions` attach to the `added` rows when running under `--baseline`. Baselines survive `--full` and SCHEMA rebuilds. `SCHEMA_VERSION` bumps from 4 to 5.

- [#37](https://github.com/stainless-code/codemap/pull/37) [`5110b1a`](https://github.com/stainless-code/codemap/commit/5110b1a595bb4b971710d0367d56770c82c91651) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(recipes): recipes-as-content registry — bundled .md siblings + project-local recipes

  Two complementary capabilities:
  1. **Bundled recipes get richer descriptions.** Every bundled recipe in
     `templates/recipes/` is now a `<id>.sql` file paired with an optional
     `<id>.md` description body (replaces the inline TypeScript map in
     `src/cli/query-recipes.ts`). Per-row `actions` templates live in YAML
     frontmatter on the `.md` instead of code. Same surface for end users
     (`--recipe <id>` / `--recipes-json` / `codemap://recipes`); single
     storage shape across bundled + project recipes.

  2. **Project-local recipes** — drop `<id>.{sql,md}` files into
     `<projectRoot>/.codemap/recipes/` to ship team-internal SQL as first-
     class recipes. Auto-discovered via `--recipe <id>`, surfaced in
     `--recipes-json` and the `codemap://recipes` MCP resource alongside
     bundled. Project recipes win on id collision; the catalog entry
     carries `shadows: true` on overrides so agents reading the catalog
     at session start see when a recipe behaves differently from the
     documented bundled version (per-execution response shape stays
     unchanged — uniformity contract preserved).

  Catalog entries (`--recipes-json` output, `codemap://recipes`
  payload) gain three additive fields: `body` (full Markdown body),
  `source` (`"bundled" | "project"`), and `shadows?` (true on
  project entries that override a bundled id). Existing consumers
  that destructure `{id, description, sql, actions?}` keep working.

  Validation: load-time lexical scan rejects DML / DDL keywords
  (`INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `ALTER` /
  `ATTACH` / `DETACH` / `REPLACE` / `TRUNCATE` / `VACUUM` / `PRAGMA`)
  in recipe SQL with recipe-aware error messages — defence in depth
  alongside the runtime `PRAGMA query_only=1` backstop in
  `query-engine.ts` shipped in the previous release.

  Implementation: pure transport-agnostic loader in
  `src/application/recipes-loader.ts`; thin shim in
  `src/cli/query-recipes.ts` preserves backwards-compat exports
  (`QUERY_RECIPES`, `getQueryRecipeSql`, etc.). Hand-rolled YAML
  frontmatter parser scoped to the `actions` shape (no `js-yaml`
  dependency).

  `.codemap.db` is gitignored as before; `.codemap/recipes/` is NOT
  (verified via `git check-ignore`) — recipes are git-tracked source
  code authored for human review.

- [#71](https://github.com/stainless-code/codemap/pull/71) [`fc6790b`](https://github.com/stainless-code/codemap/commit/fc6790ba5738fc284eaff1c8f11182ffd688c816) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(recipes): add read-only `rename-preview` recipe

  Adds a conservative `rename-preview` bundled recipe that composes the new parametrised recipe infrastructure with the new diff formatters:

  ```bash
  codemap query --recipe rename-preview \
    --params old=usePermissions,new=useAccess,kind=function \
    --format diff
  ```

  The v1 recipe emits rows shaped for `--format diff` / `diff-json` and covers:
  - symbol definition lines from `symbols`
  - direct named import specifier lines from `imports.specifiers` when `imports.resolved_path` points at the target symbol file

  It intentionally does **not** cover call sites, re-export alias chains, string literals, comments, dynamic dispatch, or template-literal property access yet. Those require more precise source-location substrate (for calls / exports) or non-structural search. The recipe `.md` documents the caveats clearly and repeats the key product-floor rule: codemap never writes files; this is a preview for review / `git apply --check`.

  Parameters:
  - `old` (required string)
  - `new` (required string)
  - `kind` (optional string)
  - `in_file` (optional string path prefix)
  - `include_tests` (optional boolean, default true)
  - `include_re_exports` (optional boolean, default true; reserved until export locations are indexed)

- [#43](https://github.com/stainless-code/codemap/pull/43) [`4061ac3`](https://github.com/stainless-code/codemap/commit/4061ac36ee1b4ae7b5cba94188adc824c5b5d8bd) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap query --format <text|json|sarif|annotations>` — pipe any recipe row-set into GitHub Code Scanning (SARIF 2.1.0) or surface findings inline on PRs (GH Actions `::notice file=…,line=…::msg`). Pure output-formatter additions on top of the existing JSON pipeline; no schema impact.

  Auto-detects file-path columns (`file_path` / `path` / `to_path` / `from_path` priority) and `line_start` (+ optional `line_end`) for SARIF region. Aggregate recipes without locations (`index-summary`, `markers-by-kind`) emit `results: []` + a stderr warning. Rule id is `codemap.<recipe-id>` for `--recipe`, `codemap.adhoc` for ad-hoc SQL. Default `result.level` is `"note"`; per-recipe overrides via `<id>.md` frontmatter (`sarifLevel`, `sarifMessage`, `sarifRuleId`) deferred to v1.x.

  `--format` overrides `--json` when both passed; `--json` stays as the alias for `--format json`. Incompatible with `--summary` / `--group-by` / baseline (different output shapes — sarif/annotations only support flat row lists).

  MCP `query` and `query_recipe` tools accept the same `format: "sarif" | "annotations"` argument; `query_batch` deferred to v1.x.

- [#75](https://github.com/stainless-code/codemap/pull/75) [`ba01d81`](https://github.com/stainless-code/codemap/commit/ba01d81303820a374ad96b157ce14dfd0378e4b1) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `suppressions` substrate — opt-in recipe-suppression markers parsed from source comments. The markers parser now recognises `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` (also `#`, `--`, `<!--`, `/*` leaders for non-JS files) and writes them to a new `suppressions(file_path, line_number, recipe_id)` table. Two scopes encoded by `line_number`: positive = next-line (the directive sits one line above; `line_number` points at the suppressed line), `0` = file scope.

  Recipe authors opt in via `LEFT JOIN suppressions s ON s.file_path = … AND s.recipe_id = '<id>' AND (s.line_number = 0 OR s.line_number = <row's line>) WHERE s.id IS NULL`. Ad-hoc SQL is unaffected. Bundled recipes that opt in today: `untested-and-dead` (line + file) and `unimported-exports` (file only — `exports` has no `line_number` column, so per-line suppression isn't expressible there).

  **Stays consistent with the "no opinionated rule engine" Floor** — no severity, no suppression-by-default, no universal-honor model. The suppression is consumer-chosen substrate: recipe authors choose whether to honor it; consumers can override per recipe by writing project-local SQL that ignores suppressions or filters differently. The leader regex requires the directive to start a line (modulo whitespace) so directives never match inside string literals — both this clone's tests and recipe `.md` examples use the directive text in prose without polluting the index.

  Schema bumps to **10** — `--full` rebuild auto-runs on next index pass. `dropAll()` includes `suppressions` (index-data table, not user data). Surfaced in agent rules + skills + glossary + architecture schema docs per Rule 10.

- [#39](https://github.com/stainless-code/codemap/pull/39) [`7460b46`](https://github.com/stainless-code/codemap/commit/7460b4652181a5bfec5b826b523d143699d7b8d0) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(show + snippet): targeted-read CLI verbs + MCP tools

  Two sibling verbs that close the "agent wants to read this thing" loop
  without composing SQL:
  - **`codemap show <name>`** — returns metadata
    (`file_path:line_start-line_end` + `signature` + `kind`) for the
    symbol(s) matching the exact name (case-sensitive).
  - **`codemap snippet <name>`** — same lookup; each match also carries
    `source` (file lines from disk), `stale` (true when content_hash
    drifted since indexing), `missing` (true when file is gone).

  Both share the same flag set (`--kind <k>` filter, `--in <path>` file
  scope — directory prefix or exact file, normalized via the existing
  `toProjectRelative` helper for cross-platform consistency).

  Output is the agent-friendly `{matches, disambiguation?}` envelope on
  both CLI `--json` and MCP responses (uniformity contract per the MCP
  plan). Single match → `{matches: [{...}]}`; multi-match adds
  `disambiguation: {n, by_kind, files, hint}` — structured aids so the
  agent narrows without scanning every row. Forward-extensible (future
  `nearest_to_cursor` / `most_recently_modified` / `caller_count` fields
  land as additive keys).

  MCP tools `show` and `snippet` register parallel to the CLI verbs and
  auto-inherit the same envelope shape.

  Stale-file behavior on snippet: `source` is always returned when the
  file exists; `stale: true` is metadata the agent reads. No refusal,
  no auto-reindex side-effects — read tool stays read-only.

  Architecturally: pure transport-agnostic engine in
  `src/application/show-engine.ts` (mirrors the cmd-_ ↔ _-engine seam
  from PRs [#33](https://github.com/stainless-code/codemap/issues/33) / [#35](https://github.com/stainless-code/codemap/issues/35) / [#37](https://github.com/stainless-code/codemap/issues/37)); thin CLI verbs in `src/cli/cmd-show.ts`
  - `src/cli/cmd-snippet.ts`. Reuses `findSymbolsByName`, `hashContent`
    (from `src/hash.ts`), `toProjectRelative` (now exported from
    `cmd-validate.ts`), and `files.content_hash` — same primitives the
    existing `validate` command already uses for stale detection. No
    schema change.

  Test coverage: 19 engine tests (lookup variants, line slicing, stale
  detection, missing files), 13 cmd-show parser/envelope tests, 11
  cmd-snippet parser/envelope/stale tests, 8 in-process MCP integration
  tests via `@modelcontextprotocol/sdk`'s `InMemoryTransport`.

- [#75](https://github.com/stainless-code/codemap/pull/75) [`ba01d81`](https://github.com/stainless-code/codemap/commit/ba01d81303820a374ad96b157ce14dfd0378e4b1) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap ingest-coverage --runtime <dir>` — V8 runtime coverage parser. Reads a `NODE_V8_COVERAGE=...`-style directory (one or more `coverage-<pid>-<ts>-<seq>.json` files) and dispatches to the existing `upsertCoverageRows` core through a new `ingestV8` parser. Each script's byte-offset ranges are converted to per-line hit counts via innermost-wins range walking (smaller, more specific ranges override the function-as-a-whole count — matches V8's documented semantics). Skips non-`file://` URLs (Node internals, `evalmachine.<anonymous>`); merges duplicate-URL scripts across dumps so multi-process test runs don't inflate `total_statements`.

  Format auto-detection is unchanged for files (`.json` → istanbul, `.info` → lcov, directory of either → probe both with explicit-error on ambiguity); `--runtime` is the explicit opt-in for V8 directories. The `coverage` table schema doesn't move — V8 rows write through the same `(file_path, name, line_start, hit_statements, total_statements, coverage_pct)` projection, so every existing JOIN (`untested-and-dead`, `files-by-coverage`, `worst-covered-exports`) works unchanged.

  Useful for "delete cold code with stronger evidence" agent flows: production-style traces from real test runs feed the same recipes that consume Istanbul/LCOV today. **Local-only — SaaS aggregation explicitly out of scope** (different product class). The parser stays in-process; no aggregation server, no upload primitive. New `format: "v8"` arm on the result envelope; existing `"istanbul" | "lcov"` consumers don't break.

  Engine module: `application/coverage-engine.ts` (added `ingestV8`, `V8ScriptCoverage`, `V8FunctionCoverage`, `V8CoveragePayload` exports). CLI module: `cli/cmd-ingest-coverage.ts` (added `--runtime` flag, `resolveV8Directory` helper that reads every top-level `*.json` in the directory and merges their `result` arrays). Pure additive — `--json` output gains `"format": "v8"` as a possible value.

### Patch Changes

- [#33](https://github.com/stainless-code/codemap/pull/33) [`114303f`](https://github.com/stainless-code/codemap/commit/114303fcbc9f61a033174c1ffaa94e3bc4003014) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap audit` (B.5 v1) — structural-drift command emitting `{head, deltas}` where each `deltas[<key>]` carries `{base, added, removed}`. Three v1 deltas: `files`, `dependencies`, `deprecated`. Two snapshot-source shapes — `--baseline <prefix>` (auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` in `query_baselines`) and `--<delta>-baseline <name>` (explicit per-delta override; composes with `--baseline`). Reuses B.6 baselines; no schema bump. `--summary` collapses to per-delta counts; `--no-index` skips the auto-incremental-index prelude. v1 ships no `verdict` / threshold config — consumers compose `--json` + `jq` for CI exit codes (v1.x slice). `--base <ref>` (worktree+reindex snapshot) defers to v1.x.

- [#70](https://github.com/stainless-code/codemap/pull/70) [`db2f27a`](https://github.com/stainless-code/codemap/commit/db2f27a69747b73c244d19583d1e54476b9a8bc8) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(complexity): cyclomatic complexity column on `symbols` + bundled recipe (research note § 1.4 ship-pick (c))

  Adds per-function cyclomatic complexity computed during AST walking. Schema bump `SCHEMA_VERSION` 7 → 8 — first reindex after upgrade triggers a full rebuild via the existing version-mismatch path.

  **What lands:**
  - New `complexity REAL` column on `symbols`. Computed via McCabe formula (`1 + decision points`) for function-shaped symbols (top-level `function` declarations + arrow-function consts). `NULL` for non-functions (interfaces, types, enums, plain consts) and class methods (v1 limitation; documented in the recipe `.md`).
  - Decision points counted: `if`, `while`, `do…while`, `for`, `for…in`, `for…of`, `case X:` arms (not `default:` fall-through), `&&` / `||` / `??` short-circuit operators, `?:` ternary, `catch` clauses.
  - New bundled recipe `high-complexity-untested` — function-shaped symbols with complexity ≥ 10 AND measured coverage < 50%. Combines structural + runtime evidence axes; surfaces refactor-priority candidates that single-axis recipes (`untested-and-dead`, `worst-covered-exports`) miss because they're "called but undertested."

  **Implementation:**
  - Parser visitor (`src/parser.ts`) maintains a `complexityStack` keyed by symbol index. On function entry, pushes counter at 1 + symbol index. Branching-node visitors increment the top counter. On function exit, pops and writes complexity into the symbol row already pushed during entry.
  - Nested function declarations get their own stack entries — inner branches don't count toward the outer function. (Standard McCabe — each function counted independently.)

  **Pre-v1 patch** per `.agents/lessons.md` "changesets bump policy": schema-bumping changes are minor in semver but pre-v1 we default to patch unless the bump forces a `.codemap.db` rebuild. This one does (column added; auto-detected by `createSchema()` mismatch path) — every consumer's first run after upgrade re-indexes from scratch.

  Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill mention the `complexity` column, the new recipe, and the cyclomatic-complexity definition.

  **Out of scope:**
  - **Class method complexity** — `MethodDefinition` visitor currently doesn't push to the complexity stack. Documented in `high-complexity-untested.md` v1 limitation; refactor opportunity for class-heavy projects.
  - **Per-class / per-file rollups** — `complexity` is per-symbol; project-local recipes can `SUM` / `AVG` it as needed.

- [#69](https://github.com/stainless-code/codemap/pull/69) [`560390b`](https://github.com/stainless-code/codemap/commit/560390b0b8dc13bc8c6ba70f0b230e73619696d6) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(fts5+mermaid): opt-in FTS5 virtual table + Mermaid output formatter

  Implements the FTS5+Mermaid plan ([`docs/plans/fts5-mermaid.md`](https://github.com/stainless-code/codemap/blob/main/docs/plans/fts5-mermaid.md)) — two non-goal flips in one PR.

  **FTS5 (opt-in, default OFF):**
  - New `source_fts` virtual table — `(file_path UNINDEXED, content)` columns, `tokenize='porter unicode61'`. Always created; populated only when toggle is on.
  - Toggle via `codemap.config.ts` `fts5: true` OR `--with-fts` CLI flag at index time. CLI overrides config (logs stderr line on override).
  - Indexer tees file content into `source_fts` in same transaction as `files` row insert (atomic). Worker → main serialization cost is zero on default-OFF path.
  - Toggle-change auto-detect via `meta.fts5_enabled` — flipping `fts5: false → true` auto-upgrades incremental → full rebuild so `source_fts` is consistently populated.
  - DB-size telemetry on first FTS5 populate: `[fts5] source_fts populated: <N> files / <X> KB`.
  - Bundled demo recipe `text-in-deprecated-functions` — `@deprecated` functions in files containing `TODO`/`FIXME`/`HACK` markers AND coverage `<50%`. Demonstrates FTS5 ⨯ `symbols` ⨯ `coverage` JOIN composability that ripgrep can't match.

  **Mermaid output formatter:**
  - New `--format mermaid` output mode. Renders `{from, to, label?, kind?}` row-shape as `flowchart LR`.
  - **Bounded-input contract** (50-edge ceiling, `MERMAID_MAX_EDGES`): unbounded inputs reject with a scope-suggestion error naming the recipe + count + scoping knobs (`LIMIT` / `--via` / `WHERE`). Auto-truncation deliberately out of scope (would be a verdict masquerading as an output mode).
  - Available across CLI, MCP `query` / `query_recipe` tools, HTTP `POST /tool/query` (text/plain content type).

  Schema bump: `SCHEMA_VERSION` 6 → 7. First reindex after upgrade triggers a full rebuild via the existing version-mismatch path; existing `.codemap/index.db` is preserved (only schema-managed tables get dropped + recreated).

  **Pre-v1 patch** per `.agents/lessons.md` "changesets bump policy" — additive feature, default-OFF for FTS5, behaviour-preserving for existing users (`--with-fts` is opt-in; Mermaid is a new output mode).

  Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` mention `--with-fts`, `--format mermaid`, the new bundled recipe, and the bounded-input contract.

- [#41](https://github.com/stainless-code/codemap/pull/41) [`0134944`](https://github.com/stainless-code/codemap/commit/0134944c2df9bbed00e4d40ce6ac3c135a983eb8) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Internal refactor — lift `cli/*` envelope builders + path helpers into `application/*` engines so `application/mcp-server.ts` no longer reaches sideways into `cli/`. Affected modules: `audit-engine` (added `resolveAuditBaselines`), new `context-engine` (`buildContextEnvelope`, `classifyIntent`, `ContextEnvelope`), new `validate-engine` (`computeValidateRows`, `toProjectRelative`), `show-engine` (added `buildShowResult`, `buildSnippetResult`, `ShowResult`, `SnippetResult`, `SnippetMatch`), `query-recipes` moved from `cli/` to `application/`. CLI verbs stay shells (parse / help / run / render). No behavior change, no public API change — `cli/cmd-*` and `application/*` are internal modules; the published surface (`api.ts`, the `codemap` binary, the MCP server) is untouched.

- [#67](https://github.com/stainless-code/codemap/pull/67) [`3e03db7`](https://github.com/stainless-code/codemap/commit/3e03db7a62584b4e676261dbdbfc7fb497c2c50a) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(mcp): add `codemap://files/{path}` + `codemap://symbols/{name}` resources (research note § 1.8)

  Two new MCP / HTTP resources for direct agent reads — saves the recipe-compose round-trip when the agent just wants "everything about this file" or "where is this symbol?".
  - **`codemap://files/{path}`** — per-file roll-up. Returns `{path, language, line_count, symbols, imports, exports, coverage}`. `imports.specifiers` parsed inline (callers don't have to JSON.parse). `coverage` is `{measured_symbols, avg_coverage_pct, per_symbol}` when coverage was ingested, else `null`. URI-encode the path.
  - **`codemap://symbols/{name}`** — symbol lookup by exact name. Returns `{matches, disambiguation?}` envelope (same shape as the `show` verb per PR [#39](https://github.com/stainless-code/codemap/issues/39)). Optional `?in=<path-prefix>` query parameter mirrors `show --in <path>` (directory prefix or exact file).

  Both reuse existing infrastructure (no schema bump): `codemap://files/` queries the existing tables; `codemap://symbols/` reuses `findSymbolsByName` + `buildShowResult` from `application/show-engine.ts`.

  **Caching policy:** catalog-style resources (`recipes`, `schema`, `skill`) lazy-cache as before. Data-shaped resources (`files/`, `symbols/`) read live every call — no caching, since the index can change between requests under `--watch`.

  Both available over MCP `read_resource` and HTTP `GET /resources/{encoded-uri}` via the existing dispatcher (no new transport plumbing).

  Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill mention the new resource templates + caching policy.

- [`8da7f3d`](https://github.com/stainless-code/codemap/commit/8da7f3df36460ae366f1ad5d0a22cea1e66d0559) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - docs(cli): `mcp --help` and `serve --help` now list every shipped tool + resource

  Stale help text in `src/cli/cmd-mcp.ts` and `src/cli/cmd-serve.ts` listed the original v1 tool / resource taxonomy. Updated to match what's registered today (verified against `src/application/mcp-server.ts`):
  - **`mcp --help` Tools section** now includes `show`, `snippet`, `impact` (was missing all three).
  - **`mcp --help` Resources section** now distinguishes lazy-cached catalog resources (`recipes`, `recipes/{id}`, `schema`, `skill`) from live read-per-call resources (`files/{path}`, `symbols/{name}`) — was listing only the original four.
  - **`serve --help` Routes section** now includes `POST /tool/impact` (was missing) and lists every mirrored MCP resource explicitly under `GET /resources/{encoded-uri}` (was a `...` ellipsis).

  No behavior change — purely a documentation accuracy fix. Bundled agent rule + skill (`templates/agents/` and `.agents/`) already enumerate the six resources correctly.

- [#75](https://github.com/stainless-code/codemap/pull/75) [`ba01d81`](https://github.com/stainless-code/codemap/commit/ba01d81303820a374ad96b157ce14dfd0378e4b1) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Outcome-shaped CLI aliases — five thin top-level verbs that wrap `query --recipe <id>`:
  - `codemap dead-code` → `query --recipe untested-and-dead`
  - `codemap deprecated` → `query --recipe deprecated-symbols`
  - `codemap boundaries` → `query --recipe boundary-violations`
  - `codemap hotspots` → `query --recipe fan-in`
  - `codemap coverage-gaps` → `query --recipe worst-covered-exports`

  Every `query` flag passes through (`--json`, `--format sarif|annotations|mermaid|diff|diff-json`, `--ci`, `--summary`, `--changed-since <ref>`, `--group-by owner|directory|package`, `--params key=value`, `--save-baseline`, `--baseline`). Run `codemap <alias> --help` for the wrapped recipe id.

  Closes the verb-obviousness gap — `codemap dead-code` is more discoverable than `codemap query --recipe untested-and-dead`. Capped at five to avoid alias-sprawl per [`roadmap.md`](../docs/roadmap.md); promote a sixth only when the recipe becomes a headline outcome.

  Mapping lives in `src/cli/aliases.ts` (`OUTCOME_ALIASES`); rewrite happens before dispatch in `src/cli/main.ts`. Pure CLI surface; no schema, no engine, no new substrate. Moat-A clean — the alias is a one-line `query --recipe <id>` rewrite, not a new primitive; the recipe IS the SQL.

- [#76](https://github.com/stainless-code/codemap/pull/76) [`dfbf4e1`](https://github.com/stainless-code/codemap/commit/dfbf4e1458542a8f0d55211bda7533e14d8cde0d) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Recipe-recency tracking** — every successful `--recipe` call now writes to a new `recipe_recency(recipe_id PK, last_run_at, run_count)` table. `--recipes-json` and the matching `codemap://recipes` / `codemap://recipes/{id}` MCP resources gain inline `last_run_at: number | null` + `run_count: number` fields per entry, so agent hosts can rank live recipes ahead of historic ones via `jq 'sort_by(.last_run_at // 0) | reverse'`. Default ON; opt-out via `.codemap/config` `recipeRecency: false` (short-circuits before any DB write — no rows ever land).

  Two write sites both call `tryRecordRecipeRun` (the failure-isolated wrapper around `recordRecipeRun`) from `application/recipe-recency.ts`: `handleQueryRecipe` in `application/tool-handlers.ts` (covers MCP + HTTP — both flow through it) and `runQueryCmd` in `cli/cmd-query.ts` (CLI — `finally` block keys off a local `recipeQuerySucceeded` flag, NOT `process.exitCode`, so `--ci`'s deliberate exit-1-on-findings is recognised as success). Counts only successful runs; recency-write failures are swallowed with a stderr `[recency] write failed: <reason>` warning so they NEVER block the recipe response. The 90-day rolling window is enforced eagerly on the write path (single indexed `DELETE` inside `recordRecipeRun` before the upsert); reads filter at SELECT time (`WHERE last_run_at >= cutoff`) and never mutate the DB so the catalog stays side-effect free for `--recipes-json` and the MCP `codemap://recipes` resources.

  The MCP/HTTP catalog cache was dropped — caching the JSON.stringify result alongside recency would freeze `last_run_at` at first-read forever per long-running `codemap mcp` / `codemap serve` lifetime. The underlying `listQueryRecipeCatalog()` is itself module-cached upstream, so the extra cost is one DB-read + one JSON.stringify per call. Schema / skill resources stay cached.

  **Local-only — no upload primitive ever ships.** The Floor exists to resist accumulation pressure. Sibling to `query_baselines` / `coverage`: intentionally absent from `dropAll()` so `--full` and `SCHEMA_VERSION` rebuilds preserve user-activity history. **No `SCHEMA_VERSION` bump** — the new table is purely additive and lands on existing DBs via `CREATE TABLE IF NOT EXISTS` on next boot.

  Schema docs: `architecture.md` § `recipe_recency`. Term entry: `glossary.md`. Bundled agent rule + skill (`templates/agents/`) + dev-side mirror (`.agents/`) updated in lockstep per Rule 10.

- [#65](https://github.com/stainless-code/codemap/pull/65) [`1b7a5c7`](https://github.com/stainless-code/codemap/commit/1b7a5c73fbabfc1cb5827e9090e32728d9d469bf) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(recipes): ship two new bundled recipes from research note § 1
  - **`components-touching-deprecated`** (research note § 1.1) — UNION of two paths surfacing components that touch `@deprecated` symbols: hook path (`components.hooks_used` JSON overlap) + call path (`calls.caller_name = component`, `callee_name` is `@deprecated`). Hook-only variants ship false negatives — recipe spells out the explicit UNION. Action template `review-deprecation-impact`.
  - **`refactor-risk-ranking`** (research note § 1.4) — per-file ranking by `(fan_in + 1) × (100 - avg_coverage_pct)`. Three correctness fixes vs the naïve formula: orphans (`fan_in = 0`) score on coverage alone via `+1`; NULL `coverage_pct` treated as 0% via `COALESCE` (otherwise the row drops from `ORDER BY`); files with no exports excluded (no public-API surface to refactor externally). Output is per-file (not per-symbol) — empirical test showed per-symbol ranking ties on file-level fan_in. Per-symbol via `calls` is a documented tuning axis for project-local override. Action template `review-refactor-impact`.

  Both recipes use only existing substrate (`components`, `calls`, `symbols`, `dependencies`, `coverage`, `files`) — no schema bump. Bundled recipe content follows the existing recipe-as-content registry pattern (PR [#37](https://github.com/stainless-code/codemap/issues/37)); project-local overrides live at `<projectRoot>/.codemap/recipes/<id>.{sql,md}`.

  Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` (ships to npm via `codemap agents init`) and `.agents/` (this clone's mirror) gain trigger-pattern entries, quick-reference rows, and recipe-id list updates.

- [#66](https://github.com/stainless-code/codemap/pull/66) [`f121d84`](https://github.com/stainless-code/codemap/commit/f121d845cd2108608c5829c44144fee5b1095bac) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - feat(recipes): ship `unimported-exports` recipe (research note § 1.2)

  Surfaces exports that have no detectable import. Useful as a starting candidate list for "what's unused?" — explicitly **NOT** a "safe to delete" list.

  V1 limitations documented in the recipe `.md`:
  1. **Re-export chains not followed** — false positives if A re-exports `bar` from B and consumers import `bar` from A. Tracked under research note § 1.2; future recipe with recursive CTE walking `re_export_source` will close the gap.
  2. **Unresolved imports ignored** — when `imports.resolved_path IS NULL` (codemap's resolver couldn't resolve a `tsconfig.json` path alias or external package), those rows don't count toward "used" matching.
  3. **Default exports skipped** — common framework entry points (Next.js `page.tsx`, Storybook stories, `vite.config.ts`) skipped to reduce noise. Override in project-local recipe if you want to include them.

  Action template `review-for-deletion` (auto_fixable: false) — agents flag for manual verification before deletion.

  Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill gain trigger-pattern row, quick-reference row, and recipe-id list update.

- [#75](https://github.com/stainless-code/codemap/pull/75) [`ba01d81`](https://github.com/stainless-code/codemap/commit/ba01d81303820a374ad96b157ce14dfd0378e4b1) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `unused-type-members` recipe — field-level enumeration of `type_members` whose owning type has no detectable importer in the project. Sister recipe to `unimported-exports`: same upstream signal at the type level, but JOINed against `type_members` so each row carries the field's name, type annotation, optionality, and readonly flag. Useful when planning a deletion of an interface and you need the full field inventory before drafting the codemod.

  **Strictly advisory.** Codemap doesn't track property access, so the recipe inherits all of `unimported-exports`'s false-positive classes plus the per-field opaqueness of indexed access (`T['field']`), `keyof T`, mapped types, type spreads, destructuring, and re-export chains. Output is a STARTING POINT for human review, never a "safe to delete" list. Bundled `.md` documents every caveat and includes tuning axes for project-local overrides.

  `unused-type-members` joins the standard recipe taxonomy and ships in `templates/recipes/unused-type-members.{sql,md}`. Reachable as `codemap query --recipe unused-type-members` (or via the `--format sarif` / `--format annotations` / `--ci` aggregate flags); rule id is `codemap.unused-type-members`. Golden-query expectation lives at `fixtures/golden/minimal/unused-type-members.json`. Pure recipe addition — no schema impact, no engine change.

## 0.4.0

### Minor Changes

- [#28](https://github.com/stainless-code/codemap/pull/28) [`91598bc`](https://github.com/stainless-code/codemap/commit/91598bc90889d092fae04e9b51b637e61f6058e4) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `symbols.visibility` column — JSDoc visibility tag (`@public` / `@private` / `@internal` / `@alpha` / `@beta`) extracted at parse time and stored as a real column. Replaces the `LIKE '%@beta%'` regex in the `visibility-tags` recipe. `SCHEMA_VERSION` bumps from 3 to 4 — `.codemap.db` rebuilds automatically on next index. Helper `extractVisibility(doc)` exported from `parser.ts`. New partial index `idx_symbols_visibility` covers `WHERE visibility IS NOT NULL` queries.

### Patch Changes

- [#29](https://github.com/stainless-code/codemap/pull/29) [`03fbddf`](https://github.com/stainless-code/codemap/commit/03fbddfc06f0eb3d7d390d3288ee290d9c4285be) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Update bundled `templates/agents/` rule and skill to cover the recent CLI surface — `codemap query --summary` / `--changed-since <ref>` / `--group-by owner|directory|package`, per-row recipe `actions`, and the new `symbols.visibility` column. The dev-side `.agents/` mirror is updated in lockstep so this clone stays self-consistent.

- [#26](https://github.com/stainless-code/codemap/pull/26) [`c32f052`](https://github.com/stainless-code/codemap/commit/c32f0522321040358dcd0f2d89946dfbb533b9ca) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap query` Tier A flags — `--summary`, `--changed-since <ref>`, `--group-by owner|directory|package`, plus per-row `actions` templates on bundled recipes. All output filters; the SQL still executes against the index. Ad-hoc SQL and the `cm.query()` programmatic API stay unchanged.

## 0.3.0

### Minor Changes

- [#23](https://github.com/stainless-code/codemap/pull/23) [`ebd4c34`](https://github.com/stainless-code/codemap/commit/ebd4c34ad7b13c573001aec4b3ada8fc3379d08e) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Agent-friendly CLI surface plus a schema v3 bump that tightens `NOT NULL` invariants. Existing `.codemap.db` files auto-rebuild on first open.
  - **New: `codemap validate [--json] [paths...]`** — diffs the on-disk SHA-256 of indexed files against `files.content_hash` and prints stale / missing / unindexed rows. Lets agents skip re-reads they don't need; exits `1` on any drift (git-status semantics)
  - **New: `codemap context [--compact] [--for "<intent>"]`** — emits a stable JSON envelope (project metadata, top hubs, recent markers, recipe catalog) for any agent or editor that wants the index in one cheap shot. `--for` runs lightweight intent classification (refactor / debug / test / feature / explore / other) and returns matched recipe ids plus a hint
  - **New: `codemap --performance`** flag — prints a per-phase timing breakdown (collect / parse / insert / index_create) and the top-10 slowest files by parse time during full rebuilds, for triaging giant or pathological inputs
  - **New: `-r` short alias for `codemap query --recipe`** + cleaner organized `codemap query --help` (sectioned flags, dynamic recipe-id padding, examples for both forms)
  - **New recipes**: `deprecated-symbols` (`@deprecated` JSDoc tag scan), `visibility-tags` (`@internal` / `@private` / `@alpha` / `@beta`), `files-hashes` (powers `validate`), `barrel-files` (top files by export count)
  - **Friendlier no-`.codemap.db` error**: `no such table: <X>` now rewrites to an actionable hint pointing at `codemap` / `codemap --full`, on both the JSON and human paths
  - **Public type surface**: new `IndexPerformanceReport`; `IndexRunStats.performance?` field; per-field JSDoc coverage on `IndexResult`, `IndexRunStats`, `ResolvedCodemapConfig`, all `db.ts` row interfaces (`FileRow`, `SymbolRow`, `ImportRow`, `ExportRow`, `ComponentRow`, `DependencyRow`, `MarkerRow`, `CssVariableRow`, `CssClassRow`, `CssKeyframeRow`, `CallRow`, `TypeMemberRow`), and `ParsedFile`
  - **Documentation**: README now leads with a "What you get" Grep/Read vs Codemap capability table and a "Daily commands" stripe; `docs/why-codemap.md` adds a "What Codemap is **not**" anti-pitch section and a scenario-keyed token-savings table (single lookup → 50-turn session) replacing the earlier hand-wave
  - **Stricter lint baseline**: enabled `prefer-const`, `consistent-type-specifier-style`, `consistent-type-definitions`, `no-confusing-non-null-assertion`, `no-unnecessary-{boolean-literal-compare,template-expression,type-assertion}`, `prefer-{includes,nullish-coalescing,optional-chain}`, and `unicorn/switch-case-braces`
  - **Schema v3 — tighter `NOT NULL` invariants**: every column whose `Row`-interface type was non-nullable is now `NOT NULL` in the SQLite DDL (`files.size`/`line_count`/`language`/`last_modified`/`indexed_at`, `symbols.line_start`/`line_end`/`signature`/`is_exported`/`is_default_export`, `imports.specifiers`/`is_type_only`/`line_number`, `exports.kind`/`is_default`, `components.hooks_used`/`is_default_export`, `markers.line_number`/`content`, `css_variables.scope`/`line_number`, `css_classes.is_module`/`line_number`, `css_keyframes.line_number`, `type_members.is_optional`/`is_readonly`). Existing v2 databases auto-rebuild via `createSchema()`'s version-mismatch detector — no manual action needed

## 0.2.2

### Patch Changes

- [`5f65c33`](https://github.com/stainless-code/codemap/commit/5f65c330d80bede97f4114820cb931bd5ac97a16) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Use vendor-neutral `.md` extension for agent rules in templates; Cursor integration remaps to `.mdc` at wiring time
  - `codemap agents init` now writes `.md` rule files to `.agents/rules/` (plain Markdown with YAML frontmatter)
  - Cursor target automatically renames rules to `.mdc` (required for frontmatter parsing); all other targets (Windsurf, Continue, Cline, Amazon Q) keep `.md`
  - `SKILL.md` now includes `name` and `description` frontmatter per the Agent Skills spec

## 0.2.1

### Patch Changes

- [`7f663be`](https://github.com/stainless-code/codemap/commit/7f663befa4ff45aafe9fd053c68fb929f49bf2eb) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Sync bundled agent rule template with schema v2: add `type_members`, `calls`, and `doc_comment` trigger patterns and query rows. Add golden scenarios and fixture coverage for both new tables.

## 0.2.0

### Minor Changes

- [#19](https://github.com/stainless-code/codemap/pull/19) [`53b2c52`](https://github.com/stainless-code/codemap/commit/53b2c5238fa7c1ccf4ee2081e524da13c5604f52) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Richer symbol metadata: generics, return types, JSDoc, type members, const values, symbol nesting, call graph
  - Signatures now include generic type parameters, return type annotations, and heritage clauses (extends/implements)
  - New `doc_comment` column on symbols extracts leading JSDoc comments
  - New `type_members` table indexes properties and methods of interfaces and object-literal types
  - New `value` column on symbols captures const literal values (strings, numbers, booleans, null)
  - New `parent_name` column on symbols tracks scope nesting; class methods/properties/getters extracted as individual symbols
  - New `calls` table tracks function-scoped call edges with `caller_scope` for qualified disambiguation (deduped per file)
  - Enum members extracted into `members` column as JSON
  - Performance: cached scope strings, hoisted hot-path regex, batch deletes, reduced redundant I/O, BATCH_SIZE 100→500
  - SCHEMA_VERSION bumped to 2

## 0.1.9

### Patch Changes

- [#17](https://github.com/stainless-code/codemap/pull/17) [`e962326`](https://github.com/stainless-code/codemap/commit/e962326991ae4f5a966d0e94cbfb7c3d69341f21) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Fix incremental detection reporting unchanged files as "changed" on every run when the working tree has uncommitted modifications. `getChangedFiles` now compares content hashes against the index before including candidates, so only truly modified files enter the indexing pipeline.

## 0.1.8

### Patch Changes

- [#15](https://github.com/stainless-code/codemap/pull/15) [`f2362f9`](https://github.com/stainless-code/codemap/commit/f2362f9d2b81398a1fa02415fc4a6ed0095d2923) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Fix three HIGH-severity bugs found via cross-audit triangulation, plus performance and docs improvements.

  **Bug fixes**
  - Add missing `onerror` handler on Bun Worker — prevents silent promise hang when a parse worker crashes
  - Require JSX return or hook usage for component detection — eliminates false positives (e.g. `FormatCurrency()` in `.tsx` files no longer indexed as a component)
  - Include previously-indexed files in incremental and `--files` modes — custom-extension files indexed during `--full` no longer silently go stale

  **Performance**
  - Batch CSS imports instead of inserting one-at-a-time (both full-rebuild and incremental paths)
  - Add `Map<string, Statement>` cache for `better-sqlite3` `run()`/`query()` — avoids ~2,000+ redundant `prepare()` calls on large projects
  - Hoist `inner.query()` in `wrap()` to prepare once per call instead of per `.get()`/`.all()`
  - Skip `PRAGMA optimize` on `closeDb` for read-only query paths

  **Docs**
  - Fix Wyhash → SHA-256 in architecture.md and SKILL.md (3 locations)
  - Correct `symbols.kind` values (`variable` → `const`, `type_alias` → `type`) and `exports.kind` values
  - Clarify `Database.query()` caching is Bun-only; Node statement cache via wrapper
  - Update architecture.md: component heuristic, statement cache, `closeDb` readonly, incremental/`--files` custom extensions
  - Update benchmark.md and golden-queries.md for enriched fixture

  **Testing**
  - Enrich `fixtures/minimal/` to cover all 10 indexed tables (CSS module, `@keyframes`, `@import`, non-component PascalCase export, FIXME marker)
  - Add 7 new golden scenarios (exports, css_variables, css_classes, css_keyframes, css_imports, markers-all-kinds, components-no-false-positives)

  **Cleanup**
  - Remove unused `analyzeDependencies: true` from CSS parser
  - Deduplicate `fetchTableStats` (was duplicated across `index-engine.ts` and `run-index.ts`)
  - Remove dead `eslint-disable-next-line` directives (oxlint doesn't enforce those rules)
  - Fix `SCHEMA_VERSION` comment (said "2", value is `1`)

## 0.1.7

### Patch Changes

- [#13](https://github.com/stainless-code/codemap/pull/13) [`13a2c14`](https://github.com/stainless-code/codemap/commit/13a2c14daa0dc555fe6dab7d318d2ccd8fdb32de) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Replace `fast-glob` with `tinyglobby` for Node include globs. Smaller dependency footprint; `expandDirectories: false` keeps matching aligned with the previous behavior.

## 0.1.6

### Patch Changes

- [`ca4b47a`](https://github.com/stainless-code/codemap/commit/ca4b47a39a09e3bc6a554258ad7a827157d261c6) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Shipped agent rules and skills now lead with **`codemap query --json`** (optional table output when **`--json`** is omitted). Add **`bun run benchmark:query`** to compare **`console.table`** vs JSON stdout size, plus integration tests for **`--json`** vs default output when **`.codemap.db`** is present. README and **`docs/`** (including **`benchmark.md`** § Query stdout) updated to match.

## 0.1.5

### Patch Changes

- [#10](https://github.com/stainless-code/codemap/pull/10) [`9d37bd5`](https://github.com/stainless-code/codemap/commit/9d37bd508ea39dae33b7ec0d4b8de72e03d2e849) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Agent templates (`templates/agents/`)**
  - Align **`codemap.mdc`** and **`skills/codemap/SKILL.md`** with the current **`codemap query --json`** contract (bootstrap / DB / SQL failures, **`process.exitCode`**).
  - SKILL: **`QUERY_RECIPES`**-aligned fan-out SQL examples and bundled-recipe determinism note.

## 0.1.4

### Patch Changes

- [#8](https://github.com/stainless-code/codemap/pull/8) [`889ed5b`](https://github.com/stainless-code/codemap/commit/889ed5b695823e9a57f133c9643af9dbb3e89236) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Query CLI**
  - **`codemap query --json`**: print a JSON array of result rows to stdout (and **`{"error":"…"}`** on SQL errors) for agents and automation. Document that the query subcommand does **not** cap rows — use SQL **`LIMIT`** for bounded results. Update bundled agent rule and skill with **`--json`** preference, verbatim structural answers, and generic SQL recipes (fan-out + sample targets).

  - **`codemap query --recipe <id>`** for bundled read-only SQL so agents can run common structural queries without embedding SQL on the command line. **`--json`** works with recipes the same way as ad-hoc SQL. Bundled ids include dependency **`fan-out`** / **`fan-out-sample`** / **`fan-out-sample-json`** (JSON1 **`json_group_array`**) / **`fan-in`**, index **`index-summary`**, **`files-largest`**, React **`components-by-hooks`** (comma-based hook count, no JSON1), and **`markers-by-kind`**. The benchmark suite uses the **`fan-out`** recipe SQL for an indexed-path scenario; docs clarify that recipes add no extra query cost vs pasting the same SQL.

  - **Recipe discovery (no index / DB):** **`codemap query --recipes-json`** prints all bundled recipes (**`id`**, **`description`**, **`sql`**) as JSON. **`codemap query --print-sql <id>`** prints one recipe’s SQL. **`listQueryRecipeCatalog()`** in **`src/cli/query-recipes.ts`** is the single derived view of **`QUERY_RECIPES`** for the JSON output.

  **Golden tests**
  - **`bun run test:golden`**: index **`fixtures/minimal`**, run scenarios from **`fixtures/golden/scenarios.json`**, and compare query JSON to **`fixtures/golden/minimal/`**. Use **`bun scripts/query-golden.ts --update`** after intentional fixture or schema changes. Documented in **benchmark.md** and **CONTRIBUTING**.

  **Query robustness**
  - With **`--json`**, **`{"error":"…"}`** is printed for invalid SQL, database open failures, and **`codemap query`** bootstrap failures (config / resolver setup), not only bad SQL. The CLI sets **`process.exitCode`** instead of **`process.exit`** so piped stdout is not cut off mid-stream.

  **Benchmark & `CODEMAP_BENCHMARK_CONFIG`**
  - Each **`indexedSql`** in custom scenario JSON is validated as a single read-only **`SELECT`** (or **`WITH` … `SELECT`**) — DDL/DML and **`RETURNING`** are rejected before execution.
  - Config file paths are resolved from **`process.cwd()`** (see **benchmark.md**). **`traditional.regex`** strings are developer-controlled (local JSON); **`files`** mode compiles the regex once per scenario.
  - Overlapping **globs** in the traditional path are **deduplicated** so **Files read** / **Bytes read** count each path once.
  - The default **components in `shop/`** scenario uses a **`LIKE`** filter aligned with the traditional globs under **`components/shop/`** (**\*.tsx** and **\*.jsx**, matching **`components`** rows from the parser) and avoids unrelated paths such as **`workshop`**.

  **Recipes (determinism)**
  - Bundled recipe SQL adds stable secondary **`ORDER BY`** columns (and orders inner **`LIMIT`** samples) so **`--recipe`** / **`--json`** output does not vary on aggregate ties.

  **External QA**
  - **`bun run qa:external`**: **`--max-files`** and **`--max-symbols`** must be positive integers (invalid values throw before indexing).

## 0.1.3

### Patch Changes

- [#6](https://github.com/stainless-code/codemap/pull/6) [`ad29694`](https://github.com/stainless-code/codemap/commit/ad2969481d4bd4e60d4f29818e4f1e64986216f9) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Align shipped agent templates with the published CLI (`codemap`, `npx @stainless-code/codemap`, …). Keep this repository’s `.agents/` rule and skill dev-oriented (`bun src/index.ts`). Remove the redundant `agents-first-convention` template. Document the dev vs `templates/agents/` split in `templates/agents/README.md` and `docs/agents.md`.

## 0.1.2

### Patch Changes

- [#4](https://github.com/stainless-code/codemap/pull/4) [`0a9d829`](https://github.com/stainless-code/codemap/commit/0a9d82935e775edfb942029c03b8a427f18f9e71) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **`codemap agents init`:** For Git repos, ensure **`.codemap.*`** is in **`.gitignore`** (create the file or append the line once). **`--force`** removes only template file paths (same relpaths under **`.agents/rules/`** and **`.agents/skills/`** as **`templates/agents`**) before merging; other files under **`.agents/`**, **`rules/`**, or **`skills/`** are kept. **`--interactive` / `-i`** — pick IDE integrations (Cursor, GitHub Copilot, Windsurf, Continue, Cline, Amazon Q, **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**) and symlink vs copy for rule mirrors; requires a TTY. Unknown positional arguments (e.g. `interactive` without `--interactive`) are rejected. Depends on **`@clack/prompts`**.

  **Docs:** **[`docs/agents.md`](https://github.com/stainless-code/codemap/blob/main/docs/agents.md)**; **[`docs/README.md`](https://github.com/stainless-code/codemap/blob/main/docs/README.md)** index updated. Root **[`.gitignore`](https://github.com/stainless-code/codemap/blob/main/.gitignore)** uses a single **`.codemap.*`** line.

## 0.1.1

### Patch Changes

- [#1](https://github.com/stainless-code/codemap/pull/1) [`b366c53`](https://github.com/stainless-code/codemap/commit/b366c532999800a1c0bb6e81aa68e6e8867baf83) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Consolidate docs (index hub, packaging/Releases, benchmark vs external root), point `.changeset/README` at packaging, and add `clean` / `check-updates` npm scripts.

## 0.1.0

### Minor Changes

- Initial release (**0.1.0**): structural SQLite index, CLI (`codemap`, `query`), programmatic API, Zod-validated `codemap.config`, Bun and Node support.
