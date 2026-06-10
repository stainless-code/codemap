# Codemap

**Query your codebase.** Codemap builds a **local SQLite index** of structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers, and more) so **AI agents and tools** can answer “where / what / who” questions with **SQL** instead of scanning the whole tree.

- **Not** grep semantics by default — use `ripgrep` / your IDE for raw text matches. Codemap ships **opt-in FTS5** (`--with-fts` / `fts5: true`) when you want body matches that JOIN with `symbols` / `coverage` / `markers` in one SQL.
- **Is** a fast, token-efficient way to navigate **structure**: definitions, imports, dependency direction, components, and other extracted facts.

**Documentation:** [docs/README.md](docs/README.md) is the hub (topic index + single-source rules). Topics: [architecture](docs/architecture.md), [agents](docs/agents.md) (`codemap agents init`), [benchmark](docs/benchmark.md), [golden queries](docs/golden-queries.md), [packaging](docs/packaging.md), [roadmap](docs/roadmap.md), [why Codemap](docs/why-codemap.md). **Bundled rules/skills:** [`.agents/rules/`](.agents/rules/), [`.agents/skills/codemap/SKILL.md`](.agents/skills/codemap/SKILL.md). **Consumers:** [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

---

## What you get

Structural questions answered in **one SQL round-trip** instead of 3–5 file reads:

| Question                                           | Grep / Read (today)                                          | Codemap                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Find a symbol by exact name                        | Glob + Read + filter by hand                                 | `SELECT name, file_path, line_start FROM symbols WHERE name = 'X'`                     |
| Who imports `~/utils/date`?                        | Grep + resolve `tsconfig` aliases manually                   | `SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%utils/date%'`        |
| Components using the `useQuery` hook               | Grep `useQuery` + filter to component files                  | `SELECT name, file_path FROM components WHERE hooks_used LIKE '%useQuery%'`            |
| Heaviest files by import fan-out                   | Impractical without a parser                                 | `SELECT from_path, COUNT(*) AS n FROM dependencies GROUP BY from_path ORDER BY n DESC` |
| All CSS keyframes / design tokens / module classes | Grep `@keyframes`, `--var-`, `.module.css` then disambiguate | One `SELECT` against `css_keyframes` / `css_variables` / `css_classes`                 |
| Deprecated symbols (`@deprecated` JSDoc)           | Grep `@deprecated` + cross-reference symbol                  | `SELECT name, kind FROM symbols WHERE doc_comment LIKE '%@deprecated%'`                |

Full schema and recipe catalog: [docs/architecture.md § Schema](docs/architecture.md#schema) · [docs/why-codemap.md](docs/why-codemap.md) · `codemap query --recipes-json`.

---

## Install

```bash
bun add @stainless-code/codemap
# or: npm install @stainless-code/codemap
```

**Engines:** Node **`^20.19.0 || >=22.12.0`** and/or Bun **`>=1.0.0`** — see `package.json` and [docs/packaging.md](docs/packaging.md).

---

## CLI

- **Installed package:** `codemap`, `bunx @stainless-code/codemap`, or `node node_modules/@stainless-code/codemap/dist/index.mjs`
- **This repo (dev):** `bun src/index.ts` (same flags)

### Daily commands

```bash
codemap                                                      # incremental index (run once per session)
codemap dead-code --json                                     # outcome alias → query --recipe untested-and-dead
codemap query --json --recipe fan-out                        # recipe SQL by id (alias: -r)
codemap query --json "SELECT name, file_path FROM symbols WHERE name = 'foo'"  # ad-hoc SQL
codemap --files src/a.ts src/b.tsx                           # targeted re-index after edits
codemap validate --json                                      # detect stale / missing / unindexed files
codemap context --compact --for "refactor auth"              # JSON envelope + intent-matched recipes
codemap ingest-coverage coverage/coverage-final.json --json  # Istanbul / LCOV (auto-detected) → coverage table; joins with symbols
NODE_V8_COVERAGE=.cov bun test && codemap ingest-coverage .cov --runtime --json  # V8 protocol (per-process dumps); local-only
codemap ingest-churn metrics/churn.json --json               # precomputed file_churn → churn-complexity-hotspots (non-git / CI)
codemap query --json --recipe churn-complexity-hotspots      # change-frequency × complexity (not the hotspots alias)
codemap agents init                                          # scaffold .agents/ rules + skills
codemap agents init --mcp                                    # PM-aware project MCP config (see docs/agents.md)
codemap apply rename-preview --params old=foo,new=bar --dry-run  # preview recipe-driven edits (substrate executor)
```

**Version-matched agent guidance:** `codemap agents init` writes **thin pointer files** to `.agents/` (short SKILL + rule). The full content is served live by **`codemap skill`** / **`codemap rule`** (CLI) and **`codemap://skill`** / **`codemap://rule`** (MCP / HTTP) — so `bun update @stainless-code/codemap` auto-refreshes the content agents see, no re-init needed. See [docs/agents.md](docs/agents.md).

### Full reference

```bash
# Index project root (optional <state-dir>/config.{ts,js,json}; --state-dir overrides .codemap/)
codemap

# Version (also: codemap --version, codemap -V)
codemap version

# Full rebuild
codemap --full

# SQL against the index (after at least one index run). Bundled agent rules/skills use --json first; omit it for console.table in a terminal.
codemap query --json "SELECT name, file_path FROM symbols LIMIT 10"
# With --json: JSON array on success; {"error":"..."} on stdout for bad SQL, DB open, or query bootstrap (config/resolver)
codemap query "SELECT name, file_path FROM symbols LIMIT 10"
# Query is not row-capped — add LIMIT in SQL for large selects
# Bundled SQL (same as skill examples): fan-out rankings
codemap query --json --recipe fan-out
codemap query --json --recipe fan-out-sample
# Outcome aliases — thin wrappers over `query --recipe <id>`; every query flag passes through.
# Capped at 5 to avoid alias-sprawl.
codemap dead-code --json                                     # → query --recipe untested-and-dead
codemap deprecated --ci                                      # → query --recipe deprecated-symbols --ci
codemap boundaries --format sarif > boundary-findings.sarif  # → query --recipe boundary-violations --format sarif
codemap hotspots --json --group-by directory                 # → query --recipe fan-in (import hubs — not churn×complexity)
codemap coverage-gaps --json --summary                       # → query --recipe worst-covered-exports --json --summary
# Parametrised recipes validate params from <id>.md frontmatter before SQL binding.
codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%
codemap query --recipe rename-preview --params old=usePermissions,new=useAccess,kind=function --format diff
# Architecture-boundary rules (declare in .codemap/config.ts):
#   boundaries: [{ name: "ui-cant-touch-server", from_glob: "src/ui/**", to_glob: "src/server/**" }]
# Default action is "deny"; the table is reconciled from config on every index pass.
codemap query --recipe boundary-violations --format sarif > boundary-findings.sarif
# Counts only (skip the rows) — pairs well with --recipe for dashboards / agent context windows
codemap query --json --summary -r deprecated-symbols
# PR-scoped: filter result rows to those touching files changed since <ref>
codemap query --json --changed-since origin/main -r fan-out
codemap query --json --summary --changed-since HEAD~5 "SELECT file_path FROM symbols"
# Group rows by directory, CODEOWNERS owner, or workspace package
codemap query --json --summary --group-by directory -r fan-in
codemap query --json --group-by owner -r deprecated-symbols
codemap query --json --summary --group-by package "SELECT file_path FROM symbols"
# Snapshot a result, refactor, then diff (saved inside .codemap/index.db, no JSON files)
codemap query --save-baseline -r visibility-tags                # save under name "visibility-tags"
codemap query --json --baseline -r visibility-tags              # full diff: {baseline, current_row_count, added, removed}
codemap query --json --summary --baseline -r visibility-tags    # counts only: {baseline, current_row_count, added: N, removed: N}
codemap query --save-baseline=pre-refactor "SELECT file_path FROM symbols"   # ad-hoc SQL needs an explicit =<name>
codemap query --baseline=pre-refactor "SELECT file_path FROM symbols"
codemap query --baselines                                       # list saved baselines
codemap query --drop-baseline visibility-tags                   # delete
# --group-by is mutually exclusive with --save-baseline / --baseline (different output shapes)
# Diff per-delta baselines vs current — files / dependencies / deprecated drift in one envelope
codemap query --save-baseline=base-files       "SELECT path FROM files"
codemap query --save-baseline=base-dependencies "SELECT from_path, to_path FROM dependencies"
codemap query --save-baseline=base-deprecated   -r deprecated-symbols
codemap audit --baseline base                                   # auto-resolves base-{files,dependencies,deprecated}
codemap audit --json --summary --baseline base                  # counts-only — useful for CI dashboards
codemap audit --files-baseline base-files                       # explicit per-delta — runs only the slots provided
codemap audit --baseline base --files-baseline hotfix-files     # mixed — auto-resolve deps + deprecated; override files
codemap audit --baseline base --no-index                        # skip the auto-incremental-index prelude (frozen-DB CI)
codemap audit --base origin/main --json                         # ad-hoc — added[].attribution; --summary adds added_introduced/inherited
codemap audit --base origin/main --format sarif                 # emit SARIF 2.1.0 directly (Code Scanning); also: --ci alias
codemap audit --base origin/main --ci                           # CI shortcut: --format sarif + non-zero exit on additions
codemap audit --base v1.0.0 --files-baseline pre-release-files  # mix --base with per-delta override
# --base materialises <ref> via `git archive | tar -x` to .codemap/audit-cache/<sha>/, reindexes into
# a cached `.codemap/index.db` at that sha, then diffs. Cache hit on second run against same sha is sub-100ms. Requires git;
# non-git projects get a clean `codemap audit: --base requires a git repository.` error.
# Recipes that define per-row action templates append "actions" hints (kebab-case verb +
# description) in --json output; ad-hoc SQL never carries actions. Inspect via --recipes-json.
# --format <text|json|sarif|annotations|mermaid|diff|diff-json|codeclimate|badge> — SARIF for GitHub
# Code Scanning; annotations for GH Actions ::notice lines; codeclimate for GitLab Code Quality;
# badge for issue-count summaries; mermaid/diff for graph and edit previews. All
# formatted outputs require a flat row list
# (no --summary / --group-by / baseline). SARIF / annotations / codeclimate / badge
# auto-detect file_path / path / to_path / from_path; rule.id is codemap.<recipe-id>
# (or codemap.adhoc). codeclimate/badge skip aggregate-only rows. Mermaid
# requires {from, to, label?, kind?} rows and rejects unbounded inputs (>50 edges) with a
# scope-suggestion error — alias columns via SELECT col AS "from", col2 AS "to".
codemap query --recipe deprecated-symbols --format sarif > findings.sarif
codemap query --recipe deprecated-symbols --ci                    # CI shortcut: --format sarif + non-zero exit + quiet
codemap query --recipe deprecated-symbols --format annotations    # one ::notice per row
# GitLab Code Quality artifact (locatable rows only; flat minor severity):
codemap query --recipe boundary-violations --format codeclimate > gl-code-quality-report.json
# Badge summary for README paste or CI (counts locatable rows only):
codemap query --recipe boundary-violations --format badge
codemap query --recipe boundary-violations --format badge --badge-style json | jq -e '.status == "pass"'
# Render any audit/SARIF output as a markdown PR-summary comment (for repos without
# Code Scanning / aggregate audit deltas / bot-context seeding):
codemap audit --base origin/main --json | codemap pr-comment - | gh pr comment <PR> -F -
codemap query --format mermaid 'SELECT from_path AS "from", to_path AS "to" FROM dependencies LIMIT 50'
codemap query --format diff 'SELECT "README.md" AS file_path, 1 AS line_start, "# Codemap" AS before_pattern, "# Codemap Preview" AS after_pattern'
codemap query --format diff-json 'SELECT "README.md" AS file_path, 1 AS line_start, "# Codemap" AS before_pattern, "# Codemap Preview" AS after_pattern' | jq '.summary'
# --with-fts — opt-in FTS5 virtual table populated at index time. Default OFF (preserves
# .codemap/index.db size); CLI flag wins over .codemap/config.ts `fts5` field. Toggle change
# auto-detects and forces a full rebuild so `source_fts` stays consistent.
codemap --with-fts --full
codemap query --recipe text-in-deprecated-functions    # demonstrates FTS5 ⨯ symbols ⨯ coverage JOIN
# HTTP API — same tool taxonomy as `codemap mcp`, exposed over POST /tool/{name} for
# non-MCP consumers (CI scripts, curl, IDE plugins). Loopback default; optional --token.
TOKEN=$(openssl rand -hex 32)
codemap serve --port 7878 --token "$TOKEN" &
curl -s -X POST http://127.0.0.1:7878/tool/query \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"sql":"SELECT name, file_path FROM symbols LIMIT 5"}'
# Watch mode — long-running process; debounced reindex on file changes (default 250ms).
# `mcp` / `serve` boot the watcher in-process by default since 2026-05 — every tool
# reads a live index without per-request prelude:
codemap mcp                           # default-ON watcher
codemap serve --port 7878             # default-ON watcher
codemap watch --quiet                 # standalone (decoupled from a transport)
codemap mcp --no-watch                # opt out for one-shot fire-and-forget calls
CODEMAP_WATCH=0 codemap mcp           # env-var opt-out (mirrors --no-watch)
# List recipe catalog (bundled + project-local) as JSON, or print one recipe's SQL (no DB required)
codemap query --recipes-json
codemap query --print-sql fan-out
# `components-by-hooks` ranks by hook count without SQLite JSON1 (comma-based count on the stored JSON array).

# Project-local recipes — drop SQL files into `<state-dir>/recipes/` (default `.codemap/recipes/`) to make them discoverable across the team
# Bundled recipes live in templates/recipes/ in the npm package; project recipes win on id collision
# (shadowing is signalled via a `shadows: true` field in --recipes-json so agents notice the override)
mkdir -p .codemap/recipes   # or: codemap --state-dir .cm --full && mkdir -p .cm/recipes
echo "SELECT path FROM files WHERE language IN ('ts', 'tsx') AND line_count > 500" \
  > .codemap/recipes/big-ts-files.sql
codemap query --recipe big-ts-files                              # auto-discovered alongside bundled

# Targeted reads — precise lookup by symbol name without composing SQL
codemap show runQueryCmd                                        # metadata: file:line + signature
codemap show foo --kind function --in src/cli                   # narrow ambiguous matches
codemap show --query 'kind:function name:Auth path:src/'        # field-qualified discovery
codemap show --query 'kind:function name:foo' --print-sql       # Moat-A SQL transparency
codemap snippet runQueryCmd                                     # same lookup + source text from disk
codemap snippet --query 'kind:function name:run' --json         # field-qualified + source body
codemap snippet foo --json                                      # {matches: [{...metadata, source, stale, missing}]}
# Output envelope is always {matches, disambiguation?, warning?} — single match → {matches: [{...}]};
# multi-match adds disambiguation: {n, by_kind, files, hint} for agent-friendly narrowing;
# warning when FTS was requested but source_fts is empty (re-index with --with-fts or fts5: true).

# Impact analysis — symbol/file blast-radius walker (callers, callees, dependents, dependencies)
codemap impact handleQuery                                      # both directions, depth 3, all compatible graphs
codemap impact src/db.ts --direction up                         # what depends on db.ts (file-level, deps + imports)
codemap impact handleAudit --depth 1 --via calls                # direct callers via the calls table only
codemap impact runWatchLoop --json --summary | jq '.summary.nodes'  # CI-gate fan-in score
# Replaces hand-composed `WITH RECURSIVE` queries. Cycle-detected, depth-bounded
# (default 3, --depth 0 = unbounded), limit-capped (default 500). Result envelope:
# {target, matches: [{depth, edge, kind, name?, file_path}], summary: {nodes, terminated_by}}.

# Affected tests — reverse dependency walk from changed sources → test files to run
codemap affected --json                                         # working-tree changes vs HEAD (git status + diff)
git diff --name-only origin/main | codemap affected --stdin --json
codemap affected src/lib/cache.ts --json                        # explicit changed paths
codemap affected --changed-since origin/main --json               # committed delta + working tree vs ref
# Moat-A twin: `affected-tests` recipe. Output: [{test_path, impact_depth}] — CI composes the runner command.

# Apply — substrate-shaped fix executor (recipe SQL describes hunks; codemap validates + writes)
# Row contract (same as --format diff-json): {file_path, line_start, before_pattern, after_pattern}
# Preview first: codemap query --recipe rename-preview --params old=foo,new=bar --format diff-json
codemap apply rename-preview --params old=usePermissions,new=useAccess,kind=function --dry-run
codemap apply rename-preview --params old=usePermissions,new=useAccess,kind=function --yes   # TTY prompts without --yes
# Homonym-safe: add define_in=src/path/to/definition.ts (scopes target; in_file only filters output rows)
# Alias: codemap rename helper worker --define-in src/path/to/definition.ts --dry-run
codemap apply migrate-import-source --params old_source=legacy,new_source=@app/core --dry-run
codemap apply stale-imports --params in_file=src/widget --dry-run  # preview; writes need --force --yes
codemap apply migrate-jsx-prop --params old_name=data-id,new_name=data-testid,component_name=ProductCard --dry-run --force
# Agent/codemod rows (no recipe policy gates): echo '[{...}]' | codemap apply --rows - --yes
# External unified diff: codemap apply --diff-input /tmp/patch.diff --dry-run
# Fixpoint (recipe mode): codemap apply rename-preview --params old=a,new=b --until-empty --yes
# Optional git commit (recipe id required): codemap apply rename-preview --params old=a,new=b --yes --commit "chore: rename a→b"
# Bundled diff-shape recipes: rename-preview, migrate-import-source, replace-marker-kind, stale-imports, migrate-deprecated, deprecated-usages, migrate-jsx-prop, add-jsdoc-deprecated
# All-or-nothing: any conflict aborts before any file is written. MCP: apply, apply_rows, apply_diff_input (yes: true for writes).

# Live agent content (pointer protocol — full body served from installed package version)
codemap skill                                                   # full codemap SKILL markdown to stdout
codemap rule                                                    # full codemap rule markdown to stdout

# MCP server (Model Context Protocol) — for agent hosts (Claude Code, Cursor, Codex, generic MCP clients)
codemap mcp                                                     # JSON-RPC on stdio (21 tools; watcher default-ON)
# Tools (21): query, query_batch, query_recipe, audit, save_baseline,
#        list_baselines, drop_baseline, context, validate, show, snippet, impact,
#        affected, trace, explore, node, apply, apply_rows, apply_diff_input,
#        ingest_coverage, ingest_churn
# CLI twins: query batch, trace, explore, node, file, schema, symbols, context --include-snippets, ingest-coverage, ingest-churn (same JSON as MCP/HTTP).
# query / query_recipe also accept baseline (same diff envelope as codemap query --baseline).
# Resources: codemap://schema, codemap://skill, codemap://rule, codemap://mcp-instructions (lazy-cached);
#            codemap://recipes, codemap://recipes/{id} (live read-per-call — recency fields stay fresh);
#            codemap://files/{path}, codemap://symbols/{name} (live read-per-call)
# Output shape verbatim from `--json` envelopes (no re-mapping). Snake_case throughout.

# Another project
codemap --root /path/to/repo --full

# Explicit config
codemap --config /path/to/config.json --full
# Override the state directory (default `.codemap/`):
codemap --state-dir .cm --full        # or: CODEMAP_STATE_DIR=.cm codemap --full
codemap unlock                        # clear stale <state-dir>/index.lock after a crashed indexer

# Re-index only given paths (relative to project root)
codemap --files src/a.ts src/b.tsx

# Scaffold .agents/ from bundled templates — full matrix: docs/agents.md
codemap agents init
codemap agents init --force
codemap agents init --mcp                                    # PM-aware project MCP config (see docs/agents.md)
codemap agents init --interactive   # -i; IDE wiring + symlink vs copy
```

**Environment / flags:** `--root` overrides **`CODEMAP_ROOT`** / **`CODEMAP_TEST_BENCH`**, then **`process.cwd()`**; **`--state-dir`** overrides **`CODEMAP_STATE_DIR`** (default `.codemap/`); **`CODEMAP_WATCH=0`** / **`CODEMAP_NO_WATCH=1`** opt out of the default-ON watcher on `mcp` / `serve` (mirrors `--no-watch`); **`CODEMAP_FORCE_WATCH=1`** overrides WSL `/mnt/*` auto-disable. Use **`codemap agents init --git-hooks`** when the watcher is off for background sync on git events. **`CODEMAP_MCP_TOOLS`** registers a subset of MCP tools (comma-separated snake_case names; see [agents.md § MCP tool allowlist](docs/agents.md#mcp-tool-allowlist)). **`CODEMAP_PARSE_TIMEOUT_MS`** — fixed per-file parse budget (ms); unset uses 10s + size scaling capped at 30s. **`CODEMAP_WORKER_RECYCLE_EVERY`** — recycle worker threads after N files (default **250**). **`CODEMAP_PARSE_WORKERS`** — worker pool size (positive integer, max 32). Indexing a project outside this clone: [docs/benchmark.md § Indexing another project](docs/benchmark.md#indexing-another-project).

**Configuration:** optional **`<state-dir>/config.{ts,js,json}`** (default `.codemap/config.*`; default export object or async factory). Shape: [codemap.config.example.json](codemap.config.example.json). Runtime validation (**Zod**, strict keys) and API surface: [docs/architecture.md § User config](docs/architecture.md#user-config). When developing inside this repo you can use `defineConfig` from `@stainless-code/codemap` or `./src/config`. If you set **`include`**, it **replaces** the default glob list entirely. **Self-healing files (D11):** `<state-dir>/.gitignore` is rewritten to canonical on every codemap boot; JSON config gets unknown-key pruning + key-sort drift; TS/JS configs are validate-only.

---

## Programmatic API (ESM)

```ts
import { createCodemap } from "@stainless-code/codemap";

const cm = await createCodemap({ root: "/path/to/repo" });
await cm.index({ mode: "incremental" });
await cm.index({ mode: "full" });
await cm.index({ mode: "files", files: ["src/a.ts"] });
await cm.index({ quiet: true });

const rows = cm.query("SELECT name FROM symbols LIMIT 5");
```

`createCodemap` configures a process-global runtime (`initCodemap`); only **one active project per process** is supported. Advanced: `runCodemapIndex` for an open DB handle. **Module layout:** [docs/architecture.md § Layering](docs/architecture.md#layering).

---

## Development

Tooling: **Oxfmt**, **Oxlint**, **tsgo** (`@typescript/native-preview`).

| Command                              | Purpose                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                        | Run the CLI from source (same as `bun src/index.ts`)                                                                                                                               |
| `bun run check`                      | Build, format check, lint, tests, typecheck, golden queries + agent-eval harness smoke — run before pushing                                                                        |
| `bun run fix`                        | Apply lint fixes, then format                                                                                                                                                      |
| `bun run test` / `bun run typecheck` | Focused checks                                                                                                                                                                     |
| `bun run test:golden`                | SQL snapshot regression on `fixtures/minimal` (included in `check`)                                                                                                                |
| `bun run test:agent-eval`            | Agent-eval harness smoke on `fixtures/minimal` — probe + live MCP handlers (included in `check`; [docs/benchmark.md § Agent eval harness](docs/benchmark.md#agent-eval-harness))   |
| `bun run test:golden:external`       | Tier B: local tree via `CODEMAP_*` / `--root` (not in default `check`)                                                                                                             |
| `bun run benchmark:query`            | Compare `console.table` vs `--json` stdout size (needs local `.codemap/index.db`; [docs/benchmark.md § Query stdout](docs/benchmark.md#query-stdout-table-vs-json-benchmarkquery)) |
| `bun run qa:external`                | Index + sanity checks + benchmark on `CODEMAP_ROOT` / `CODEMAP_TEST_BENCH`                                                                                                         |

```bash
bun install
bun run check    # build + format:check + lint:ci + test + typecheck + test:golden + test:agent-eval
bun run fix      # oxlint --fix, then oxfmt
```

**Readability & DX:** Prefer clear names and small functions; keep **JSDoc** on public exports. [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) has contributor workflow and conventions.

---

## Benchmark

Use a **real** project path (the repo must exist on disk). See [docs/benchmark.md § Indexing another project](docs/benchmark.md#indexing-another-project).

```bash
CODEMAP_ROOT=/absolute/path/to/indexed-repo bun src/benchmark.ts
```

Optional **`CODEMAP_BENCHMARK_CONFIG`** for repo-specific scenarios: [docs/benchmark.md § Custom scenarios](docs/benchmark.md#custom-scenarios-codemap_benchmark_config).

To compare **query** stdout size (`console.table` vs **`--json`**) on an existing index, see [docs/benchmark.md § Query stdout](docs/benchmark.md#query-stdout-table-vs-json-benchmarkquery) (**`bun run benchmark:query`**).

---

## Organization

Developed under **[stainless-code](https://github.com/stainless-code)** on GitHub.

## License

MIT — see [LICENSE](LICENSE).
