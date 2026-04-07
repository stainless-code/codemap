# Benchmarking & external project roots

**Index:** [README.md](./README.md) · **Why an index:** [why-codemap.md](./why-codemap.md)

**Two topics — pick the row that matches what you need:**

| You want to…                                                                                                                                       | Read                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Point Codemap at another directory** (large app clone, QA target) while hacking in **this** repo — `CODEMAP_*`, `.env`, where `.codemap.db` goes | [§ Indexing another project](#indexing-another-project) |
| **Measure SQL vs glob+read+regex** after an index exists — `src/benchmark.ts`, scenarios, fixtures                                                 | [§ The benchmark script](#the-benchmark-script)         |

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

**Where `.codemap.db` lives:** defaults to **`<indexed-project-root>/.codemap.db`**, not inside the Codemap repo — add `.codemap.db` to that project’s `.gitignore` if needed.

**Agents:** Work in the **stainless-code/codemap** window with [`.agents/rules/codemap.mdc`](../.agents/rules/codemap.mdc) and the [skill](../.agents/skills/codemap/SKILL.md). Queries resolve against whatever **`CODEMAP_*`** / **`--root`** selected.

---

## The benchmark script

`src/benchmark.ts` compares **indexed SQL** vs a **traditional** path (glob → read → regex). It does **not** configure which project is indexed — use [§ Indexing another project](#indexing-another-project) or `CODEMAP_ROOT=fixtures/minimal` first, then run the script.

### Overview

1. **Indexed** — single SQL query against `.codemap.db`
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

### Methodology

Each scenario runs both approaches back-to-back on the same machine, same data. Measured:

| Metric     | What it captures                                                  |
| ---------- | ----------------------------------------------------------------- |
| Index Time | Wall-clock time for the SQL query                                 |
| Trad. Time | Wall-clock time for glob + read all matching files + regex search |
| Results    | Number of matches returned                                        |
| Files Read | How many files the traditional approach had to read               |
| Bytes Read | Total source bytes loaded into memory by the traditional approach |
| Speedup    | `traditionalMs / indexMs`                                         |

**Important**: the traditional approach simulates best-case AI tool behavior — it reads files in-process with Bun's fast I/O. Real AI agent tool calls add network round-trips, context window serialization, and multiple turn overhead that make the gap significantly larger.

### CLI and runtime startup

This document measures **indexed SQL vs traditional glob/read** on an existing database — **not** process startup time or **Node vs Bun** as runtimes.

- **Lazy CLI:** **`dist/index.mjs`** stays small; **`codemap --help`** / **`version`** load only bootstrap + the matching **dynamic import** chunk ([architecture.md § Layering](./architecture.md#layering)).
- **Node vs Bun:** **`console.table`** output can differ slightly; SQL semantics match ([packaging.md § Node vs Bun](./packaging.md#node-vs-bun)). This benchmark does not compare Node vs Bun startup or wall time.

**CI** runs **`node dist/index.mjs query "SELECT 1"`** after build to smoke-test the **Node + better-sqlite3** path ([`ci.yml`](../.github/workflows/ci.yml)).

### Scenarios

| #   | Scenario                                | What it tests                                        |
| --- | --------------------------------------- | ---------------------------------------------------- |
| 1   | Find where `usePermissions` is defined  | Symbol lookup by name — needle in haystack           |
| 2   | List React components (TSX/JSX)         | AST `components` table vs export-line regex          |
| 3   | Files that import from `~/api/client`   | Large result set — LIKE scan vs grep                 |
| 4   | Find all TODO/FIXME markers             | Cross-file scan — all file types                     |
| 5   | CSS design tokens (custom properties)   | Domain-specific extraction — structured vs raw regex |
| 6   | Components in `shop/` subtree           | Scoped component discovery                           |
| 7   | Reverse deps: who imports `utils/date`? | Dependency graph traversal                           |

### Results

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

**Totals**: Index ~408µs vs Traditional ~26.7ms (**~65× overall** on a sample run). Traditional bytes read total ~393 KB (not megabytes) because the globbed sets are small.

On a **large app** indexed via `--root`, the same queries typically return non-zero rows; the indexed side stays sub-millisecond while the traditional side reads megabytes for broad globs. Repeatable numbers: [Fixtures](#fixtures).

#### Run-to-run variance

On a small repo, totals move with noise and thermal variance. On a large indexed tree, **per-scenario** index times stay sub-millisecond while traditional times scale with files read. Re-run `bun src/benchmark.ts` after changing code or index target.

The script’s **reindex** section averages **3 internal runs** per mode; full-rebuild wall time varies with disk and CPU load.

The indexed CSS scenario uses `ORDER BY name LIMIT 50` — exact SQL for each scenario lives in **`src/benchmark.ts`** in this repo (not duplicated here; keep in sync when changing scenarios).

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

#### Where the index doesn't help

- **Full-text search** — the index doesn't store source code, so you still need grep/read for content-level queries (e.g. "find all usages of `console.log`")
- **Questions about code logic** — the index captures structure (names, types, locations), not semantics (what the code does)

### Fixtures

#### `fixtures/minimal/`

Small **private** package (not published) with intentional:

- `usePermissions`, `~/api/client` import, `components/shop/*`, `utils/date`, CSS variables, and a TODO marker.

**Local:**

```bash
export CODEMAP_ROOT="$(pwd)/fixtures/minimal"
bun run dev --full
bun run benchmark
```

**CI:** the workflow **Benchmark (fixture)** runs the same steps with `CODEMAP_ROOT=$GITHUB_WORKSPACE/fixtures/minimal`.

Scenario titles match the table above; **indexed row counts** on the fixture are stable for a given schema. A larger second fixture is optional — see [roadmap.md](./roadmap.md).
