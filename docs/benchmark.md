# Codemap — Benchmark

## Overview

Compares two approaches to answering common code-discovery questions:

1. **Indexed** — single SQL query against `.codemap.db`
2. **Traditional** — `Glob` → `readFileSync` → regex match (simulates what AI agent tools like Grep/Read/Glob do)

The benchmark script lives at `src/benchmark.ts`.

**OSS note:** Scenario names and paths in the tables below came from **historical snapshots** of a large application. For reproducible numbers, we plan **fixture apps** under `fixtures/` — see [Fixtures (planned)](#fixtures-planned).

## Prerequisites

The database must exist (otherwise the script errors on the warmup query). Build the index once:

```bash
bun src/index.ts
# or a clean slate:
bun src/index.ts --full
```

From an installed package, the same commands work as `codemap` / `codemap --full` (see [README.md](../README.md)).

## Running

```bash
# Summary table (includes reindex timing at the end)
bun src/benchmark.ts

# Verbose — shows per-scenario breakdown and result samples
bun src/benchmark.ts --verbose
```

## Methodology

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

## Scenarios

| #   | Scenario                                | What it tests                                        |
| --- | --------------------------------------- | ---------------------------------------------------- |
| 1   | Find where `usePermissions` is defined  | Symbol lookup by name — needle in haystack           |
| 2   | List React components (TSX/JSX)         | AST `components` table vs export-line regex          |
| 3   | Files that import from `~/api/client`   | Large result set — LIKE scan vs grep                 |
| 4   | Find all TODO/FIXME markers             | Cross-file scan — all file types                     |
| 5   | CSS design tokens (custom properties)   | Domain-specific extraction — structured vs raw regex |
| 6   | Components in `shop/` subtree           | Scoped component discovery                           |
| 7   | Reverse deps: who imports `utils/date`? | Dependency graph traversal                           |

## Results

Example snapshot from `bun src/benchmark.ts` immediately after `bun src/index.ts --full` on **this repository** (small tree; many scenario result counts are zero — that is expected here). Numbers vary by machine and project shape. Settings: schema v2, `Bun.hash` content fingerprints, `db.query()` caching, covering/partial indexes, mmap, worker threads, deferred indexes, `batchInsert` helper.

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

On a **large app** indexed via `--root`, the same queries typically return non-zero rows; the indexed side stays sub-millisecond while the traditional side reads megabytes for broad globs. [Fixtures (planned)](#fixtures-planned) describes the plan for CI-friendly trees.

### Run-to-run variance

On a small repo, totals move with noise and thermal variance. On a large indexed tree, **per-scenario** index times stay sub-millisecond while traditional times scale with files read. Re-run `bun src/benchmark.ts` after changing code or index target.

The script’s **reindex** section averages **3 internal runs** per mode; full-rebuild wall time varies with disk and CPU load.

The indexed CSS scenario uses `ORDER BY name LIMIT 50` — see `benchmark.ts` for the exact queries.

## Key Takeaways

### Speed

- **Symbol / component queries** — covering indexes resolve from the index B-tree; indexed time stays sub-millisecond while the traditional path reads every matching file for regex
- **TODO markers** — pre-extracted markers across indexed file types vs a narrower traditional glob
- **Imports** — `imports` table vs full-file scan for a given module prefix
  Indexed SQL timings above are sub-millisecond per scenario. See [architecture.md § SQLite Performance Configuration](./architecture.md#sqlite-performance-configuration) for PRAGMAs and indexes.

### Accuracy

- **React components**: Index uses the same JSX/TSX component heuristic as the rest of the tool; regex “export” scans can over- or under-count vs `components`
- **CSS tokens**: Indexed rows are structured; raw `--var` regexes often pick up duplicates and non-token matches
- **TODO markers**: Index scans more configured extensions than a single glob in the benchmark’s traditional path

See [why-codemap.md § Accuracy Gains](./why-codemap.md#accuracy-gains) for the full analysis.

### Token Impact (AI Agents)

See [why-codemap.md § Token Efficiency](./why-codemap.md#token-efficiency) for the full analysis. On a large tree, the traditional approach can read tens of megabytes across scenarios; indexed queries return only matching rows.

### Reindex Cost

The benchmark also measures the cost of keeping the index fresh (3 runs each, same session as the table above):

| Scenario                 | Avg   | Min   | Max   |
| ------------------------ | ----- | ----- | ----- |
| Targeted (3 files)       | ~38ms | ~37ms | ~39ms |
| Incremental (no changes) | ~59ms | ~57ms | ~62ms |
| Full rebuild             | ~87ms | ~85ms | ~89ms |

**Full rebuild** uses worker thread parallelism (N workers for file I/O + parsing), deferred index creation, generic `batchInsert` helper, and sorted inserts — see [architecture.md § Full Rebuild Optimizations](./architecture.md#full-rebuild-optimizations).

**Targeted reindex** (`--files`) is the fastest option when the AI knows which files it modified — it skips git diff and filesystem scanning entirely. Incremental uses DB-sourced `indexedPaths` instead of a full `collectFiles()` glob scan, and passes only changed files to the indexer. Both are fast enough to run after every editing step. Full rebuild is appropriate when switching branches or after a rebase.

### Where the Index Doesn't Help

- **Full-text search** — the index doesn't store source code, so you still need grep/read for content-level queries (e.g. "find all usages of `console.log`")
- **Questions about code logic** — the index captures structure (names, types, locations), not semantics (what the code does)

## Fixtures (planned)

### Problem

Historical benchmark scenarios used paths and labels tied to a **specific product tree**. In this OSS repo, those paths are **not canonical** — the [Results](#results) tables above are **illustrative** methodology from snapshots, not guaranteed reproducible numbers across machines.

### Direction

Introduce **one or more small example / test apps** under this repo (e.g. `fixtures/minimal-react/`, `fixtures/monorepo-ts/`) that:

- Include **stable, intentional** symbols, imports, CSS tokens, and markers.
- Are indexed with a **pinned `codemap.config`** so `src/benchmark.ts` runs against a **known layout**, not whatever `cwd` happens to be.
- Allow CI to run **deterministic** index + benchmark steps in isolation.

### Work items

- [ ] Add `fixtures/<name>/` with minimal TS/React components, sample pages, and CSS/markers.
- [ ] Point CI / docs at `CODEMAP_ROOT=$PWD/fixtures/<name>` (or `--root`) for benchmark runs.
- [ ] Rename benchmark scenario titles to match fixture semantics (e.g. paths under `fixtures/...`) or neutral names (“scoped component subtree”).
- [ ] Optionally vendor **two** fixtures (small vs medium) to show scale without depending on a private app.

Until fixtures exist, treat the [Results](#results) tables as **illustrative** methodology only.
