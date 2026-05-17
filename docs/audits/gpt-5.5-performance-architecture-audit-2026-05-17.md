# GPT-5.5 Performance Architecture Audit

Date: 2026-05-17
Status: Open audit
Scope: performance improvements without intentional functionality change

## Coverage

- Tracked repo inventory: 415 paths from `git ls-files`.
- File modes: 390 regular tracked files, 3 executable tracked files, 22 tracked symlinks.
- Explicit doc/agent surfaces: all `.agents/` and `docs/` paths were enumerated; central governance, architecture, benchmark, roadmap, glossary, plans, and research docs were read directly or through scoped review.
- Existing untracked audit notes read as context only: `codex-5.3-performance-architecture-audit.md`, `docs/research/claude-opus-4-7-performance-architecture-audit.md`, `docs/research/composer-performance-architecture-audit.md`, `kimi-k2.5-architecture-performance-audit.md`.
- Fresh index evidence: `bun src/index.ts --full --performance` on this repo indexed 340 files, 6,593 symbols, 42,598 references, 32,144 bindings, and 393 dependencies.

Official docs checked: SQLite WAL / PRAGMA / `busy_timeout` / `WITHOUT ROWID`, Bun SQLite and Workers docs, Oxc parser docs, Lightning CSS docs, and Chokidar project docs. Codebase facts below were checked against `src/`, `docs/architecture.md`, `docs/benchmark.md`, `docs/roadmap.md`, and live Codemap SQL.

## Current Performance Snapshot

`bun src/index.ts --full --performance`:

| Phase        |  ms |
| ------------ | --: |
| collect      | 260 |
| parse        | 162 |
| insert       | 163 |
| index_create |  68 |
| index_run    | 596 |

`bun src/benchmark.ts`:

| Area                                      | Result                |
| ----------------------------------------- | --------------------- |
| Indexed queries vs traditional scan total | 43.98 ms vs 462.92 ms |
| Traditional bytes read across scenarios   | ~6.9 MB               |
| Reindex benchmark, targeted 3 files       | avg 185.66 ms         |
| Reindex benchmark, incremental no changes | avg 202.79 ms         |
| Reindex benchmark, full rebuild           | avg 705.84 ms         |

Architecture strengths already in place: WAL, `synchronous=NORMAL`, `temp_store=MEMORY`, `mmap_size`, enlarged SQLite cache, `STRICT` tables, selected `WITHOUT ROWID` tables, batched inserts, deferred index creation on full rebuild, sorted inserts, worker parsing, and `closeDb({ readonly: true })` on read paths.

## Prioritized Findings

### P0: Instrument The Hidden Full-Rebuild Tail

The current performance report explains `parse + insert + index_create`, but `index_run` is larger by about 203 ms in the measured run. Code shows full rebuild also runs `resolveBindings`, `persistModuleCycles`, and `persistReExportChains` after index creation, but those phases are not timed separately.

Plan:

- Add `bindings_ms`, `module_cycles_ms`, and `re_export_chains_ms` to `IndexPerformanceReport`.
- Print them under `--performance`.
- Only optimize those phases after measurements show where time is going.

Risk: very low. Additive instrumentation only.

Validation: `bun src/index.ts --full --performance`; sum reported phases against `index_run` within rounding.

### P0: Reduce File Collection Work

`collectFiles()` is the largest measured phase at 260 ms. Code currently iterates include patterns and calls `globSync()` per pattern, then post-filters excluded directories with `isPathExcluded()`. This preserves behavior, but it can walk excluded trees before filtering.

Plan:

- Extend `globSync()` to accept pattern arrays and exclude globs where the runtime supports them.
- Route `excludeDirNames` into the glob layer as `**/<name>/**` ignores.
- Keep `isPathExcluded()` as a parity backstop.
- First PR should only prove identical collected path sets before/after.

Risk: low-medium because glob semantics differ across Bun and Node.

Validation: compare sorted `collectFiles()` output before/after on this repo and `fixtures/minimal`; run `bun run test:golden`; rerun `--full --performance`.

### P0: Make `query_batch` Use One Read Connection

`executeQueryBatch()` currently maps each statement to `executeQuery()`, and `executeQuery()` opens a database, sets `PRAGMA query_only = 1`, runs one statement, and closes it. That keeps semantics simple, but it defeats the point of batch execution for N reads.

Plan:

- Add an internal helper that accepts an existing read-only DB handle.
- Run every batch statement through one DB connection.
- Preserve current per-statement `{error}` isolation.
- Keep `PRAGMA query_only = 1` for the whole batch handle.

Risk: low if output envelopes stay byte-for-byte compatible.

Validation: tests for mixed success/failure batch items, summary/group-by variants, and changed-since behavior.

### P1: Add SQLite Lock Resilience For Benign Writer Collisions

Parallel recipe queries produced `[recency] write failed: database is locked` warnings during this audit. That write is failure-isolated, but it is still noise and can occasionally leak as a user-visible error if the lock happens during DB open or query setup. `openCodemapDatabase()` sets WAL-related PRAGMAs but does not set `PRAGMA busy_timeout`.

Plan:

- Add a small `busy_timeout` on every connection, or at least on recipe-recency writer connections.
- Consider `openDb({ readonly: true })` / `openDb({ purpose: "query" })` so read paths do not run avoidable writer-ish setup.
- Keep recipe recency failure-isolated.

Risk: low-medium. A timeout can add latency under real contention, so keep it small and test concurrent reads/writes.

Validation: stress test parallel `query --recipe` calls; assert recipe outputs still succeed and recency warnings disappear or become rare.

### P1: Avoid Double Read + Hash In Incremental Indexing

`getChangedFiles()` reads each candidate file and hashes it to decide whether it changed. The incremental branch in `indexFiles()` then reads and hashes the same changed files again before parsing. This is behaviorally safe but wasted I/O and CPU.

Plan:

- Return a `Map<path, { source, hash }>` from the changed-file detection path.
- Let `indexFiles()` consume cached source/hash for incremental runs.
- Keep targeted `--files` behavior unchanged unless a similar cache is explicitly passed.

Risk: low. Memory rises with changed-file count, but the source strings are already needed moments later.

Validation: row-set equality on `fixtures/minimal`; synthetic multi-file edit benchmark.

### P1: Add Benchmark CI Before Riskier Refactors

`docs/roadmap.md` already calls for falsifiable benchmark CI. This audit confirms that a few numbers vary materially run-to-run, especially process-level reindex timings. Performance work should not ship on anecdotes.

Plan:

- Start with a lightweight CI job over `fixtures/minimal` plus optional local Tier B external corpus.
- Track medians/ranges for full rebuild, no-change incremental, targeted reindex, and selected queries.
- Gate only on large regressions at first; report smaller shifts.

Risk: low. No product behavior change.

Validation: CI job produces stable enough measurements over repeated runs.

### P2: Defer Worker And IPC Changes Until Instrumented

`worker-pool.ts` uses fixed file-count chunks and spawns workers per full rebuild. `parse-worker-core.ts` sends arrays of row objects back to the main thread. Bun Worker docs note optimized `postMessage` paths for simple payloads, so changing the IPC format blindly could regress.

Plan:

- Add timing to split pure worker parse time from worker-to-main IPC / flattening time.
- Only then consider dynamic scheduling, worker-count configuration, or transfer-friendly payloads.

Risk: medium. Worker changes can disturb ordering, memory, and Node/Bun parity.

Validation: row equality plus before/after `parse_ms` and IPC-specific timings.

## Suggested Slice Order

1. Instrument hidden full-rebuild phases.
2. Optimize `collectFiles()` with path-set parity tests.
3. Refactor `query_batch` to one read connection.
4. Add lock-resilience around recipe-recency writes / query opens.
5. Remove incremental double read/hash.
6. Add benchmark CI guardrails.
7. Revisit worker scheduling and IPC only with measurements.

Each slice should be independently shippable and validated with `bun run format:check`, `bun run lint`, `bun run typecheck`, affected `bun test`, and `bun run test:golden` when indexing or query behavior is touched.

## Non-Goals For This Plan

- No schema slimming. `docs/roadmap.md` Moat B says schema breadth is the product substrate.
- No default FTS5 flip. That is a product/storage decision, not a silent performance patch.
- No change to query output envelopes, recipe semantics, `apply` behavior, or rebuild/user-data lifecycle.
- No long-lived read connection for one-shot CLI until MCP/HTTP-specific lifecycle tests prove it is safe.
