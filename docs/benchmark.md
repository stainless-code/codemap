# Benchmarking & external project roots

**Index:** [README.md](./README.md) · **Why an index:** [why-codemap.md](./why-codemap.md)

**Two topics — pick the row that matches what you need:**

| You want to…                                                                                                                                             | Read                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Point Codemap at another directory** (large app clone, QA target) while hacking in **this** repo — `CODEMAP_*`, `.env`, where `.codemap/index.db` goes | [§ Indexing another project](#indexing-another-project)                          |
| **Measure SQL vs glob+read+regex** after an index exists — `src/benchmark.ts`, scenarios, fixtures                                                       | [§ The benchmark script](#the-benchmark-script)                                  |
| **Compare `codemap query` table vs `--json` stdout** (lines/bytes) on an existing index                                                                  | [§ Query stdout (`benchmark:query`)](#query-stdout-table-vs-json-benchmarkquery) |
| **Guardrail full-rebuild per-phase walls against a committed baseline** (local + weekly scheduled)                                                       | [§ Perf baseline (regression guardrail)](#perf-baseline-regression-guardrail)    |
| **A/B agent eval** — MCP-on vs discovery-without-index tool-call + token comparison on fixed probes                                                      | [§ Agent eval harness](#agent-eval-harness)                                      |

---

## Indexing another project

Develop Codemap in **this repository** but index a **different tree** (e.g. another clone). That project does **not** need Codemap as a dependency.

**Precedence:** `--root <path>` (CLI) → **`CODEMAP_ROOT`** → **`CODEMAP_TEST_BENCH`** → `process.cwd()`.

**Day-to-day (Cursor on this repo):**

1. Copy [`.env.example`](../.env.example) to **`.env`** here (gitignored).
2. Set **`CODEMAP_TEST_BENCH`** to the **absolute path** of the project to index.

[Bun](https://bun.sh) loads `.env` from the current working directory when you run `bun src/index.ts`, so the index targets that tree without passing `--root` each time.

**One-off:**

```bash
CODEMAP_TEST_BENCH=/absolute/path/to/your-app bun src/index.ts --full
```

Use **`CODEMAP_ROOT`** instead of **`CODEMAP_TEST_BENCH`** if you prefer; behavior is the same.

**Where `.codemap/index.db` lives:** defaults to **`<indexed-project-root>/.codemap/index.db`**, not inside the Codemap repo. The codemap-managed `<state-dir>/.gitignore` reconciler ignores it automatically on first boot; no manual `.gitignore` edits needed.

**Agents:** Work in the **stainless-code/codemap** window with [`.agents/rules/codemap.md`](../.agents/rules/codemap.md) and the [skill](../.agents/skills/codemap/SKILL.md). Queries resolve against whatever **`CODEMAP_*`** / **`--root`** selected.

---

## The benchmark script

`src/benchmark.ts` compares **indexed SQL** vs a **traditional** path (glob → read → regex). It does **not** configure which project is indexed — use [§ Indexing another project](#indexing-another-project) or `CODEMAP_ROOT=fixtures/minimal` first, then run the script.

### Overview

1. **Indexed** — single SQL query against `.codemap/index.db`
2. **Traditional** — glob (same implementation as the indexer — [packaging.md § Node vs Bun](./packaging.md#node-vs-bun)) → **`readFileSync`** → regex match (simulates what AI agent tools like Grep/Read/Glob do)

For **repeatable** numbers, use **`fixtures/minimal/`** ([Fixtures](#fixtures)) or index your own app with **`CODEMAP_ROOT`** before running the script.

### Prerequisites

The database must exist (otherwise the script errors on the warmup query). Build the index once:

```bash
bun src/index.ts
# or a clean slate:
bun src/index.ts --full
```

From an installed package, the same commands work as `codemap` / `codemap --full` (see [README.md](../README.md)).

### Running

```bash
# Summary table (includes reindex timing at the end)
bun src/benchmark.ts

# Verbose — shows per-scenario breakdown and result samples
bun src/benchmark.ts --verbose
```

### Query stdout: table vs JSON (`benchmark:query`)

After **`bun src/index.ts`** (or **`codemap`**) has created **`.codemap/index.db`** in the project you are measuring:

```bash
bun run benchmark:query
```

This runs **`scripts/benchmark-query-output.ts`**, which executes the same SQL with and without **`--json`** and prints line and byte counts. Default output uses **`console.table`**; **`--json`** emits a single JSON array — typically **smaller and easier for agents** to parse (see bundled **`templates/agents/`**). Requires a non-empty index at the repo root you run from.

### Custom scenarios (`CODEMAP_BENCHMARK_CONFIG`)

For a **specific** checkout (e.g. large app), you can replace or extend the eight built-in demo scenarios with JSON so the **Results** column lines up with **indexed SQL** vs **glob + regex** on the same corpus.

```bash
# Use a real checkout path — /path/to/repo in docs is a placeholder only.
# Resolve CODEMAP_BENCHMARK_CONFIG from the shell cwd (see below).
CODEMAP_ROOT=/absolute/path/to/your-app CODEMAP_BENCHMARK_CONFIG=fixtures/benchmark/my.local.json bun src/benchmark.ts
```

- **Tracked example:** [fixtures/benchmark/scenarios.example.json](../fixtures/benchmark/scenarios.example.json) — copy to `*.local.json` (see [.gitignore](../.gitignore); do not commit proprietary paths).
- **`CODEMAP_BENCHMARK_CONFIG`** is passed to **`path.resolve()`** from **`process.cwd()`** — use an absolute path or a path relative to where you run the command (not relative to **`src/`**).
- Each entry has **`name`**, **`indexedSql`**, and **`traditional`**: either **`{ "globs": [...], "regex": "...", "mode": "files" | "matches" }`** or **`{ "builtin": "fanoutImportLines" }`** (same traditional path as **`--recipe fan-out`**). **`indexedSql`** must be a **single** read-only **`SELECT`** (or **`WITH` … `SELECT`**) — mutating statements are **rejected** at load time.
- **`traditional.regex`:** treated as trusted input from your local JSON (benchmark tooling is developer-facing). **`mode": "files"`** reuses one **`RegExp`** per scenario for efficiency.
- **`replaceDefault`:** `true` (default) uses only this list; `false` **appends** these scenarios after the built-in eight.

### Methodology

Each scenario runs both approaches back-to-back on the same machine, same data. Measured:

| Metric     | What it captures                                                                             |
| ---------- | -------------------------------------------------------------------------------------------- |
| Index Time | Wall-clock time for the SQL query                                                            |
| Trad. Time | Wall-clock time for glob + read all matching files + regex search                            |
| Results    | Number of matches returned                                                                   |
| Files Read | How many **unique** files the traditional approach read (overlapping globs are deduplicated) |
| Bytes Read | Total source bytes loaded for those unique paths (each file counted once)                    |
| Speedup    | `traditionalMs / indexMs`                                                                    |

**Important**: the traditional approach simulates best-case AI tool behavior — it reads files in-process with Bun's fast I/O. Real AI agent tool calls add network round-trips, context window serialization, and multiple turn overhead that make the gap significantly larger.

### CLI and runtime startup

This document measures **indexed SQL vs traditional glob/read** on an existing database — **not** process startup time or **Node vs Bun** as runtimes.

- **Lazy CLI:** **`dist/index.mjs`** stays small; **`codemap --help`** / **`version`** load only bootstrap + the matching **dynamic import** chunk ([architecture.md § Layering](./architecture.md#layering)).
- **Node vs Bun:** **`console.table`** output can differ slightly; SQL semantics match ([packaging.md § Node vs Bun](./packaging.md#node-vs-bun)). This benchmark does not compare Node vs Bun startup or wall time.

**CI** runs **`node dist/index.mjs query "SELECT 1"`** after build to smoke-test the **Node + better-sqlite3** path ([`ci.yml`](../.github/workflows/ci.yml)).

### Scenarios

| #   | Scenario                                | What it tests                                                       |
| --- | --------------------------------------- | ------------------------------------------------------------------- |
| 1   | Find where `usePermissions` is defined  | Symbol lookup by name — needle in haystack                          |
| 2   | List React components (TSX/JSX)         | AST `components` table vs export-line regex                         |
| 3   | Files that import from `~/api/client`   | Large result set — LIKE scan vs grep                                |
| 4   | Find all TODO/FIXME markers             | Cross-file scan — all file types                                    |
| 5   | CSS design tokens (custom properties)   | Domain-specific extraction — structured vs raw regex                |
| 6   | Components in `shop/` subtree           | Scoped component discovery                                          |
| 7   | Reverse deps: who imports `utils/date`? | Dependency graph traversal                                          |
| 8   | Top 10 by dependency fan-out            | Same SQL as **`codemap query --recipe fan-out`** vs line-scan proxy |

### Recipes vs ad-hoc SQL

**`codemap query --recipe <id>`** expands to the same SQL as pasting that string after **`codemap query`** ([README § CLI](../README.md#cli) — **`--print-sql`**, **`--recipes-json`**). There is no extra query cost beyond parsing argv — **recipe vs hand-written SQL is not a separate benchmark**.

- **`fan-out-sample`** uses **`GROUP_CONCAT`** for sample targets (portable).
- **`fan-out-sample-json`** uses **`json_group_array`** in the same shape (requires SQLite JSON1). Prefer **`fan-out-sample`** when JSON1 is unavailable.

### Results

**Snapshot only — not CI-gated.** Regenerate with `bun src/benchmark.ts` (or `bun src/index.ts benchmark`) after reindexing; numbers vary by machine, thermal state, and tree size.

Example snapshot from `bun src/benchmark.ts` immediately after `bun src/index.ts --full` on **this repository** (small tree; many scenario counts are zero). Numbers vary by machine and project. Schema, indexes, and content fingerprints: [architecture.md § Schema](./architecture.md#schema).

| Scenario                                | Index Time | Results | Trad. Time | Results | Files Read | Bytes Read | Speedup  |
| --------------------------------------- | ---------- | ------- | ---------- | ------- | ---------- | ---------- | -------- |
| Find where `usePermissions` is defined  | 55µs       | 0       | 5.65ms     | 0       | 13         | 76.3 KB    | **104×** |
| List React components (TSX/JSX)         | 85µs       | 0       | 3.54ms     | 0       | 0          | 0 B        | **42×**  |
| Files that import from `~/api/client`   | 69µs       | 0       | 4.32ms     | 0       | 13         | 76.3 KB    | **63×**  |
| Find all TODO/FIXME markers             | 75µs       | 10      | 4.23ms     | 9       | 26         | 164.2 KB   | **57×**  |
| CSS design tokens (custom properties)   | 47µs       | 0       | 2.78ms     | 0       | 0          | 0 B        | **59×**  |
| Components in `shop/` subtree           | 40µs       | 0       | 2.61ms     | 0       | 0          | 0 B        | **66×**  |
| Reverse deps: who imports `utils/date`? | 39µs       | 0       | 3.59ms     | 0       | 13         | 76.3 KB    | **93×**  |
| Top 10 by dependency fan-out            | 81µs       | 2       | 15.24ms    | 10      | 56         | 163.4 KB   | **188×** |

**Totals** (8 scenarios; sample run on this repo after adding scenario 8): Index ~1.1ms vs Traditional ~140ms (**~132× overall**). Traditional bytes read total ~940 KB on that run — your tree and hardware will differ. Older 7-scenario snapshots showed ~408µs / ~27ms / ~393 KB.

On a **large app** indexed via `--root`, the same queries typically return non-zero rows; the indexed side stays sub-millisecond while the traditional side reads megabytes for broad globs. Repeatable numbers: [Fixtures](#fixtures).

#### Run-to-run variance

On a small repo, totals move with noise and thermal variance. On a large indexed tree, **per-scenario** index times stay sub-millisecond while traditional times scale with files read. Re-run `bun src/benchmark.ts` after changing code or index target.

The script’s **reindex** section averages **3 internal runs** per mode; full-rebuild wall time varies with disk and CPU load.

The indexed CSS scenario uses `ORDER BY name LIMIT 50`. The **fan-out** row’s indexed path uses **`getQueryRecipeSql("fan-out")`** from **`src/application/query-recipes.ts`** (same text as **`codemap query --recipe fan-out`**). Other default scenarios’ SQL lives in **`src/benchmark-default-scenarios.ts`**; custom JSON is loaded in **`src/benchmark-config.ts`** (keep **`fixtures/benchmark/scenarios.example.json`** in sync when recipe SQL changes).

### Key takeaways

#### Speed

Indexed queries use **covering / partial indexes** on the SQLite side; the traditional path scales with **files read** and regex work. PRAGMAs and index design: [architecture.md § SQLite Performance Configuration](./architecture.md#sqlite-performance-configuration).

#### Accuracy

Structured parsing vs regex tradeoffs (components, CSS, markers, imports): [why-codemap.md § Accuracy Gains](./why-codemap.md#accuracy-gains).

#### Token impact (AI agents)

[why-codemap.md § Token Efficiency](./why-codemap.md#token-efficiency).

#### Reindex cost

The benchmark also measures the cost of keeping the index fresh (3 runs each, same session as the table above):

| Scenario                 | Avg   | Min   | Max   |
| ------------------------ | ----- | ----- | ----- |
| Targeted (3 files)       | ~38ms | ~37ms | ~39ms |
| Incremental (no changes) | ~59ms | ~57ms | ~62ms |
| Full rebuild             | ~87ms | ~85ms | ~89ms |

**Full rebuild** uses worker thread parallelism (N workers for file I/O + parsing), deferred index creation, generic `batchInsert` helper, and sorted inserts — see [architecture.md § Full Rebuild Optimizations](./architecture.md#full-rebuild-optimizations).

**Targeted reindex** (`--files`) is the fastest option when the AI knows which files it modified — it skips git diff and filesystem scanning entirely. Incremental uses DB-sourced `indexedPaths` instead of a full `collectFiles()` glob scan, and passes only changed files to the indexer. Both are fast enough to run after every editing step. Full rebuild is appropriate when switching branches or after a rebase.

## Perf baseline (regression guardrail)

Independent of the consumer-facing scenarios above, the repo carries a **per-phase wall guardrail** for the full-rebuild path. Wired during the [perf-architecture triangulation Tier 1.2](./plans/perf-triangulation-rollout.md).

### Mechanism

1. `bun src/index.ts --full --performance` populates [`IndexPerformanceReport`](../src/application/types.ts) with `collect_ms` / `parse_ms` / `insert_ms` / `index_create_ms` / `bindings_ms` / `module_cycles_ms` / `re_export_chains_ms` / `total_ms`.
2. Setting `CODEMAP_PERFORMANCE_JSON=<path>` dumps that report as JSON to `<path>` after the run (no CLI flag added; env-var only).
3. [`scripts/check-perf-baseline.ts`](../scripts/check-perf-baseline.ts) (alias `bun run check:perf-baseline`) runs the indexer 3× on this repo, takes per-phase **medians**, and compares to `fixtures/benchmark/perf-baseline.json`.
4. **Local / scheduled only** — run before perf-sensitive PRs; [`.github/workflows/perf-baseline.yml`](../.github/workflows/perf-baseline.yml) fires weekly + `workflow_dispatch` for drift visibility. **Not** on the PR CI path (6 min × 3 runs + bimodal GHA runners → flaky merge gate).

### Why this is separate from `src/benchmark.ts`

| Surface                                  | Audience                       | Fixture                                            | Gate?                                         |
| ---------------------------------------- | ------------------------------ | -------------------------------------------------- | --------------------------------------------- |
| `bun run benchmark` (`src/benchmark.ts`) | Consumers — speedup claims     | `fixtures/minimal` (or `CODEMAP_BENCHMARK_CONFIG`) | No (informational; runs in PR CI)             |
| `bun run check:perf-baseline`            | Maintainers — regression guard | This repo (self-index)                             | Local + weekly scheduled (not merge-blocking) |

The perf-baseline targets _this_ repo because (a) the bindings/cycles tail is only measurable on a tree with real cross-file edges, and (b) the audit triangulation's numbers were captured here.

### Tuning knobs

| Env var                       | Default | Effect                                                             |
| ----------------------------- | ------- | ------------------------------------------------------------------ |
| `CODEMAP_PERF_RUNS`           | 3       | How many `--full --performance` runs to take median over           |
| `CODEMAP_PERF_REGRESSION_PCT` | 25      | Percent over baseline median that fails the check                  |
| `CODEMAP_PERF_NOISE_FLOOR_MS` | 10      | Baseline phases under this median are not gated (jitter dominates) |

### Updating the baseline

After an intentional perf change (e.g. Tier 2-5 of the triangulation, schema bump, dep upgrade), capture a new baseline:

```bash
bun run check:perf-baseline:update
```

This rewrites `fixtures/benchmark/perf-baseline.json` with current medians + the HEAD commit. **Commit the baseline change in the same PR** as the intentional perf shift so reviewers see the delta in the diff.

### Baseline provenance: CI runner, not local

The committed baseline is **captured from a GitHub Actions Ubuntu runner**, not from local dev hardware. GitHub runners are systematically 2-4× slower than typical dev machines on the parse + insert phases (fewer vCPUs, slower disk). Setting the baseline from local would cause every CI run to spuriously fail.

Implication for local devs:

- Local `bun run check:perf-baseline` should show **wide negative deltas** (you're faster than CI). That's expected — passes the check.
- Local `bun run check:perf-baseline:update` will write **dev-machine** numbers. **Do not commit those.** If you need to refresh the baseline because of an intentional perf change, let CI capture the numbers and copy them in, OR open a PR with the baseline update and trust CI to validate it.
- Future improvement: a `workflow_dispatch` job that re-captures + commits the baseline from CI itself, removing the manual copy step.

#### CI runner variance (bimodal)

GitHub Actions `ubuntu-latest` runners are **not homogeneous**. On the same commit, perf-baseline can land on a fast tier (~630 ms `total_ms`) or a slow tier (~1117 ms) — a ~75% spread with no code change. Within a single job, 3–5 consecutive runs on one runner stay tight; cross-job variance dominates.

**Symptom:** `index_create_ms` or `parse_ms` fails at +25–35% while `total_ms` is only +15% (under gate). Recent example: [CI run 26409304578](https://github.com/stainless-code/codemap/actions/runs/26409304578) — `index_create_ms` 104→137 (+31.7%) on a slow runner; an earlier run the same day passed at 633 ms total on a fast runner.

**Baseline strategy:** capture medians from the **slow tier** (copy from a failing or borderline scheduled CI log, not from local dev). Fast-tier runs then show negative deltas (pass). The +25% gate still catches real regressions on the slow tier when you run the check locally or on the weekly workflow.

**When refreshing:** aggregate medians from 2–3 slow-tier CI logs on `main`, not a single lucky fast run.

#### Where the index doesn't help

- **Full-text search by default** — the normal index does not store source text. Use grep/read for raw body searches, or opt in to FTS5 (`--with-fts` / `fts5: true`) when you need body matches joinable with structural tables.
- **Questions about code logic** — the index captures structure (names, types, locations), not semantics (what the code does)

### Fixtures

#### `fixtures/minimal/`

Small **private** package (not published) with intentional coverage of all indexed tables:

- **Symbols / imports / dependencies**: `usePermissions`, `~/api/client` path alias, `components/shop/*`, `utils/date`
- **Components**: `ShopButton` (JSX return) + `FormatPrice` (PascalCase non-component — validates detection heuristic)
- **CSS**: variables (`--color-brand`, `--spacing-md`), class selectors (`.container`, `.primary` in a `.module.css`), `@keyframes fadeIn`, `@import` edge
- **Markers**: `TODO` (in `notes.md`) + `FIXME` (in `consumer.ts`)

**Local:**

```bash
export CODEMAP_ROOT="$(pwd)/fixtures/minimal"
bun run dev --full
bun run benchmark
```

**CI:** the workflow **Benchmark (fixture)** runs the same steps with `CODEMAP_ROOT=$GITHUB_WORKSPACE/fixtures/minimal`.

### Agent eval harness

Dev-only A/B harness in [`scripts/agent-eval/`](../scripts/agent-eval/) (not shipped in npm). Compares a **codemap MCP-on** arm (one `query` tool call per probe) against an **MCP-off** arm that simulates agent discovery (`glob` → `read` × N → `grep`). Probes mirror [golden scenarios](../fixtures/golden/scenarios.json); see [`scripts/agent-eval/scenarios.json`](../scripts/agent-eval/scenarios.json).

**One-command local run:**

```bash
bash scripts/agent-eval/run-arms.sh
# default output: .agent-eval/comparison.json
```

Environment overrides: `AGENT_EVAL_OUTPUT`, `AGENT_EVAL_RUNS`, `AGENT_EVAL_FIXTURE_ROOT`. Optional real agent session logs: `AGENT_EVAL_LOG=path/to/export.json bash scripts/agent-eval/run-arms.sh` (prints parsed tool metrics via `print-log-metrics.ts`).

**Metrics (per scenario and summary):** tool-call sequence + count, wall time, estimated tokens (`chars / 4`), success bit (both arms returned rows). Results stay local JSON — no telemetry upload ([plan](./plans/agent-eval-harness.md) L.5).

**Methodology notes:**

- **Probe mode** is deterministic (no LLM): it measures structural cost of indexed SQL vs traditional file scan on the same corpus. Use it for regression guardrails and fixture tuning.
- **Log mode** parses exported agent transcripts (entries / messages / line formats) when you run live A/B sessions with MCP on vs off.
- External public repos (zod, fastify, etc.) are a follow-up: point `AGENT_EVAL_FIXTURE_ROOT` at an indexed tree and extend probe definitions — same harness, not duplicated fixtures.

Plan: [`docs/plans/agent-eval-harness.md`](./plans/agent-eval-harness.md). CI nightly / `workflow_dispatch` is optional and not wired yet.

**Correctness (golden queries):** `bun run test:golden` indexes `fixtures/minimal`, runs SQL against [fixtures/golden/scenarios.json](../fixtures/golden/scenarios.json), and compares to [fixtures/golden/minimal/](../fixtures/golden/minimal/). See [golden-queries.md](./golden-queries.md). Refresh goldens after intentional fixture or schema changes: `bun scripts/query-golden.ts --update`.

**Tier B (local tree, not in default CI):** `bun run test:golden:external` (or `bun scripts/query-golden.ts --corpus external`) indexes **`CODEMAP_ROOT`**, **`CODEMAP_TEST_BENCH`**, or **`--root`**, loads [fixtures/golden/scenarios.external.json](../fixtures/golden/scenarios.external.json) if present else [scenarios.external.example.json](../fixtures/golden/scenarios.external.example.json), and writes/compares goldens under `fixtures/golden/external/` (gitignored). Use **`match`** in scenarios for subset checks (`minRows`, `everyRowContains`); use **`budgetMs`** with optional **`--strict-budget`** for perf warnings. Do not commit proprietary paths or goldens from private apps.

Scenario titles match the table above; **indexed row counts** on the fixture are stable for a given schema. A larger second fixture is optional — see [roadmap.md](./roadmap.md).
