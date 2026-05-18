---
"@stainless-code/codemap": patch
---

**Performance: full-rebuild wall down ~21% on small trees and ~18% on a real-world ~2k-file external corpus.** Headline contributor: `collectFiles` switched to a single `tinyglobby` call with `ignore` patterns (collect_ms -93%, file set bit-identical via `followSymbolicLinks: false`). Bindings/cycles/re-exports phase now keeps the bulk-INSERT PRAGMA-OFF window open through full rebuild (bindings_ms -33% on the 2k corpus). Plus `query_batch` single connection, incremental double-read kill, shared `countLines` helper, `stmtCache` placeholder memo, SQLite `busy_timeout`, adapter `Map` lookup, byte-order sort, FTS5 batched delete, and `getAllFileHashes` hoist.

**Instrumentation:** `IndexPerformanceReport` now surfaces `bindings_ms`, `module_cycles_ms`, `re_export_chains_ms` (previously rolled into `total_ms` with no breakdown). Set `CODEMAP_PERFORMANCE_JSON=<path>` to dump the report as JSON post-run (no new CLI flag added).

**Knobs:** `CODEMAP_PARSE_WORKERS=N` (clamped `[1, 32]`) overrides the default `max(2, min(cpus, 6))` worker count. `bun run check:perf-baseline` + a non-blocking CI job (`📈 Perf baseline (self-index)`) guard against per-phase regressions vs `fixtures/benchmark/perf-baseline.json`; `CODEMAP_PERF_RUNS` / `CODEMAP_PERF_REGRESSION_PCT` / `CODEMAP_PERF_NOISE_FLOOR_MS` tune the checker.

**Behavior change (correctness hardening):** `queryRows` (the implementation behind `Codemap.query()`, `codemap apply` recipe SQL execution, `bun run test:golden`, and the `cmd-query` print/grouped paths) now sets `PRAGMA query_only = 1` to mirror `executeQuery`'s read-only enforcement. DML / DDL slipping through these paths now errors at SQLite instead of mutating the database. All these call sites are contractually read-only; this turns a contract into an enforceable boundary. Existing tests pass unchanged. Anyone who relied on undocumented mutation through `Codemap.query("DELETE FROM ...")` would now get an error — but that was always API abuse.

Full design context: `docs/plans/perf-triangulation-rollout.md` (synthesis + execution rollout of 5 independent perf/architecture audits authored 2026-05-17).
