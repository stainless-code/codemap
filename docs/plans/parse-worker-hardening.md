# Parse worker hardening — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~1 week)
>
> **Motivator:** Full rebuild uses a worker pool (`src/worker-pool.ts`) but workers run until chunk completes with no per-file timeout or mid-batch recycle. Pathological files (minified bundles, huge generated TS) can hang or balloon memory.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1) · related [perf-triangulation-rollout](./perf-triangulation-rollout.md) Phase 3 deferrals

---

## Pre-locked decisions

| #   | Decision                                                                                   | Source                     |
| --- | ------------------------------------------------------------------------------------------ | -------------------------- |
| L.1 | **Per-file parse timeout** — default 10s, scaled by file size (cap e.g. 30s).              | Bound blast radius         |
| L.2 | **Worker recycle** — restart worker after N files (default 250) within a full rebuild.     | Contain native heap growth |
| L.3 | On timeout: log to [errors.log](./index-lock-and-error-log.md), skip file, continue index. | Partial index > hung index |
| L.4 | Incremental sequential parse gets same timeout wrapper (main thread).                      | Parity                     |

---

## Implementation steps

1. **Extend `worker-pool.ts`**
   - `Promise.race` around worker message with timeout
   - Track files-per-worker; terminate + respawn at interval
2. **Timeout helper in `parse-worker-core.ts`** — cancel/ignore late responses
3. **Wire error log** on timeout/OOM
4. **Config knobs** (optional v1): env `CODEMAP_PARSE_TIMEOUT_MS`, `CODEMAP_WORKER_RECYCLE_EVERY`
5. **Tests** — fixture that sleeps in mock worker; verify skip + log
6. **Benchmark** — ensure recycle doesn't regress perf baseline on codemap self-index

---

## Acceptance

- [ ] Hung parse terminates within timeout
- [ ] Full rebuild completes with skip count in summary
- [ ] errors.log records skipped paths

---

## Dependencies

- [index-lock-and-error-log](./index-lock-and-error-log.md) for failure persistence
