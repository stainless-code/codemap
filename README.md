# Codemap

**Query your codebase.** Codemap builds a **local SQLite index** of structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers, and more) so **AI agents and tools** can answer “where / what / who” questions with **SQL** instead of scanning the whole tree.

- **Not** full-text search or grep on arbitrary strings — use those when you need raw file-body search.
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
codemap query --json --recipe fan-out                        # bundled SQL via recipe id (alias: -r)
codemap query --json "SELECT name, file_path FROM symbols WHERE name = 'foo'"  # ad-hoc SQL
codemap --files src/a.ts src/b.tsx                           # targeted re-index after edits
codemap validate --json                                      # detect stale / missing / unindexed files
codemap context --compact --for "refactor auth"              # JSON envelope + intent-matched recipes
codemap agents init                                          # scaffold .agents/ rules + skills
```

**Version-matched agent guidance:** the published npm package ships **`templates/agents/`** (rules + skills) keyed to that version, so `codemap agents init` writes guidance that matches the CLI you installed. See [docs/agents.md](docs/agents.md).

### Full reference

```bash
# Index project root (optional codemap.config.ts / codemap.config.json)
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
# Counts only (skip the rows) — pairs well with --recipe for dashboards / agent context windows
codemap query --json --summary -r deprecated-symbols
# PR-scoped: filter result rows to those touching files changed since <ref>
codemap query --json --changed-since origin/main -r fan-out
codemap query --json --summary --changed-since HEAD~5 "SELECT file_path FROM symbols"
# Group rows by directory, CODEOWNERS owner, or workspace package
codemap query --json --summary --group-by directory -r fan-in
codemap query --json --group-by owner -r deprecated-symbols
codemap query --json --summary --group-by package "SELECT file_path FROM symbols"
# Snapshot a result, refactor, then diff (saved inside .codemap.db, no JSON files)
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
# Recipes that define per-row action templates append "actions" hints (kebab-case verb +
# description) in --json output; ad-hoc SQL never carries actions. Inspect via --recipes-json.
# List bundled recipes as JSON, or print one recipe's SQL (no DB required)
codemap query --recipes-json
codemap query --print-sql fan-out
# `components-by-hooks` ranks by hook count without SQLite JSON1 (comma-based count on the stored JSON array).

# Project-local recipes — drop SQL files into .codemap/recipes/ to make them discoverable across the team
# Bundled recipes live in templates/recipes/ in the npm package; project recipes win on id collision
# (shadowing is signalled via a `shadows: true` field in --recipes-json so agents notice the override)
mkdir -p .codemap/recipes
echo "SELECT path FROM files WHERE language IN ('ts', 'tsx') AND line_count > 500" \
  > .codemap/recipes/big-ts-files.sql
codemap query --recipe big-ts-files                              # auto-discovered alongside bundled

# Targeted reads — precise lookup by symbol name without composing SQL
codemap show runQueryCmd                                        # metadata: file:line + signature
codemap show foo --kind function --in src/cli                   # narrow ambiguous matches
codemap snippet runQueryCmd                                     # same lookup + source text from disk
codemap snippet foo --json                                      # {matches: [{...metadata, source, stale, missing}]}
# Output envelope is always {matches, disambiguation?} — single match → {matches: [{...}]};
# multi-match adds disambiguation: {n, by_kind, files, hint} for agent-friendly narrowing.

# MCP server (Model Context Protocol) — for agent hosts (Claude Code, Cursor, Codex, generic MCP clients)
codemap mcp                                                     # JSON-RPC on stdio; one tool per CLI verb plus query_batch
# Tools: query, query_batch (MCP-only — N statements in one round-trip), query_recipe, audit,
#        save_baseline, list_baselines, drop_baseline, context, validate
# Resources: codemap://recipes, codemap://recipes/{id}, codemap://schema, codemap://skill (lazy-cached)
# Output shape verbatim from `--json` envelopes (no re-mapping). Snake_case throughout.

# Another project
codemap --root /path/to/repo --full

# Explicit config
codemap --config /path/to/codemap.config.json --full

# Re-index only given paths (relative to project root)
codemap --files src/a.ts src/b.tsx

# Scaffold .agents/ from bundled templates — full matrix: docs/agents.md
codemap agents init
codemap agents init --force
codemap agents init --interactive   # -i; IDE wiring + symlink vs copy
```

**Environment / flags:** `--root` overrides **`CODEMAP_ROOT`** / **`CODEMAP_TEST_BENCH`**, then **`process.cwd()`**. Indexing a project outside this clone: [docs/benchmark.md § Indexing another project](docs/benchmark.md#indexing-another-project).

**Configuration:** optional **`codemap.config.ts`** (default export object or async factory) or **`codemap.config.json`**. Shape: [codemap.config.example.json](codemap.config.example.json). Runtime validation (**Zod**, strict keys) and API surface: [docs/architecture.md § User config](docs/architecture.md#user-config). When developing inside this repo you can use `defineConfig` from `@stainless-code/codemap` or `./src/config`. If you set **`include`**, it **replaces** the default glob list entirely.

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

| Command                              | Purpose                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                        | Run the CLI from source (same as `bun src/index.ts`)                                                                                                                         |
| `bun run check`                      | Build, format check, lint, tests, typecheck — run before pushing                                                                                                             |
| `bun run fix`                        | Apply lint fixes, then format                                                                                                                                                |
| `bun run test` / `bun run typecheck` | Focused checks                                                                                                                                                               |
| `bun run test:golden`                | SQL snapshot regression on `fixtures/minimal` (included in `check`)                                                                                                          |
| `bun run test:golden:external`       | Tier B: local tree via `CODEMAP_*` / `--root` (not in default `check`)                                                                                                       |
| `bun run benchmark:query`            | Compare `console.table` vs `--json` stdout size (needs local `.codemap.db`; [docs/benchmark.md § Query stdout](docs/benchmark.md#query-stdout-table-vs-json-benchmarkquery)) |
| `bun run qa:external`                | Index + sanity checks + benchmark on `CODEMAP_ROOT` / `CODEMAP_TEST_BENCH`                                                                                                   |

```bash
bun install
bun run check    # build + format:check + lint + test + typecheck
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
