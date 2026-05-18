# Perf-triangulation rollout

Post-merge sequencing for the perf-architecture triangulation work in PRs #95 (audit docs) + #96 (Tier 1–5 code). Each phase below is independently shippable; phases are ordered by risk-adjusted ROI. Closes when Phase 5 (audit-doc closure) runs.

**Provenance:** [`docs/audits/2026-05-17-performance-architecture-triangulation.md`](../audits/2026-05-17-performance-architecture-triangulation.md) — synthesis of 5 independent perf/architecture audits. This plan is the execution rollout for that audit; it doesn't add new findings.

---

## Phase 0 — pre-merge housekeeping

- [x] **Changeset** for PR #96 covering (a) the perf-wall improvements, (b) `IndexPerformanceReport` new fields (`bindings_ms`, `module_cycles_ms`, `re_export_chains_ms`), (c) `queryRows` `PRAGMA query_only = 1` hardening (the only user-visible behavior change). Shipped in [#96](https://github.com/stainless-code/codemap/pull/96).
- [x] **PR #95** ready for review → merged.
- [x] **PR #96** ready for review → merged.

## Phase 1 — merge + CI variance characterisation

- [x] Merge [PR #95](https://github.com/stainless-code/codemap/pull/95) (audit docs, zero functionality change).
- [x] Merge [PR #96](https://github.com/stainless-code/codemap/pull/96) (Tier 1–5 perf code).
- [x] **CI variance characterised on first run** — within-run variance ~5% (882/838/866 ms total across 3 internal samples), well inside the 25% threshold. Issue was systematic CI-slowness (2-4× vs local), not noise.
- [x] **Re-baselined from CI runner medians** in [#99](https://github.com/stainless-code/codemap/pull/99) (`ebb862e`) — local was the wrong baseline source; GitHub's Ubuntu runners are systematically slower on parse + insert phases.
- [x] **Promoted `📈 Perf baseline (self-index)` to hard gate** in [#100](https://github.com/stainless-code/codemap/pull/100) (`c0cdf0e`) — dropped `continue-on-error: true`, added to `ci-complete`'s required-jobs list, and added to branch protection's `required_status_checks.contexts` via `gh api`.

## Phase 2 — quick PRAGMA + INSERT tuning follow-up

Single focused PR titled `perf: full-rebuild PRAGMA + INSERT tuning`. Three commits, each measured against the perf-baseline before and after. Expected total impact: ~200-500 ms on a 2k-file corpus.

- [ ] `feat(perf): PRAGMA journal_mode = OFF during full-rebuild bulk-insert window` — SQLite docs estimate 20-30% on bulk INSERT throughput. Crash-recovery story for full rebuild is already "rerun `--full`" (rebuild starts with `dropAll` + `createTables`); WAL contributes nothing during that window.
- [ ] `feat(perf): INSERT (not INSERT OR REPLACE) on full-rebuild bulk paths` — table is empty after `dropAll`, conflicts impossible, SQLite skips the conflict-check codepath. ~5-15%. Incremental paths keep `INSERT OR REPLACE` (re-indexing a changed file must overwrite).
- [ ] `feat(perf): per-table BATCH_SIZE = min(500, floor(999/col_count))` — wide tables (20-col `symbols`) hit `SQLITE_MAX_VARIABLE_NUMBER=999` long before 500 rows; narrow tables (4-col `bindings`) under-batch. Per-table optimum.

Run benchmark on both this repo and a real-world ~2k-file external corpus per commit. Refresh `perf-baseline.json` after the last commit.

## Phase 3 — plan PRs before code (architectural changes)

Each is a **docs-only PR** that lands a `docs/plans/<name>.md` for design review. No implementation until plan is approved. These are real architectural changes — a wrong design here means slow rollback.

### Phase 3a — `docs/plans/parse-insert-pipeline.md`

Overlap parse and insert phases. Today: workers finish all parsing → main thread sorts → main thread inserts. Pipelining: as worker chunks complete, main starts inserting that chunk while later workers parse. Theoretical save: ~300-500 ms on big trees.

Open questions to settle in the plan:

- Approximate vs exact sort order — B-tree locality (`architecture.md` § Sorted inserts) requires monotonic insert order, not strictly sorted. Pipelining means insert starts before final sort completes; does monotonic-within-chunk suffice?
- One transaction per chunk vs one big transaction wrapping all inserts. Trade-off: per-chunk = better error isolation; single = lower commit overhead.
- Error-isolation per chunk (a parse failure in one chunk shouldn't roll back inserts of earlier chunks).
- `IndexPerformanceReport.insert_ms` semantics when phases overlap — does it report wall time or sum of insert work?
- Worker → main IPC encoding (audit Tier 5.2 hypothesis: CBOR / transferables). Likely pre-requisite: ship a `parse_ms_pure_worker` timer split first so the IPC fraction is measurable.

### Phase 3b — `docs/plans/ast-cache.md`

The biggest unshipped horizontal-scaling primitive. Hash-keyed cache of `ParsedFile` rows → skip re-parse on hash hit. Massive win for big trees with low churn (typical CI watch loop, monorepo `git pull` that doesn't touch most files).

Open questions:

- Cache substrate: `.codemap/parse-cache/<hash>.json` (file per row) vs new `parsed_cache` table in `index.db` (rolled into the main file) vs sidecar `index-cache.db`.
- Invalidation keys: `content_hash` is necessary but not sufficient. Also: `SCHEMA_VERSION`, parser version (oxc release), adapter version, `fts5_enabled` toggle, any extractor-affecting config.
- Cache size management: LRU vs manual prune (`codemap cache prune`) vs unbounded. Disk-space tradeoff estimate: ~100-500 bytes per row × millions of rows on big trees.
- Cache hit semantics in full rebuild vs incremental: full rebuild today is "drop + recreate"; with a cache, full becomes "drop + recreate from cache where possible". Need explicit `--no-cache` for cache invalidation cases.
- Cold-start cost on first run (no cache yet) — no regression vs today.
- Cache poisoning: what if a cached row is corrupt / wrong? Detection + recovery.
- Interaction with the worker pool: workers consult cache before parsing; main reconciles.

## Phase 4 — trigger-gated deferrals (not on the critical path)

These ship when their respective trigger fires, not proactively. The triangulation audit documents each trigger inline. **Audit closure (Phase 5) folds these into a single `roadmap.md` line so this plan can retire.**

- **Tier 5.2 IPC encoding** — fires after Phase 3a's `parse_ms_pure_worker` split shows IPC > ~30% of `parse_ms`.
- **Tier 5.4 markers lineMap reuse** — fires only if marker extraction becomes hot on >10k-file trees.
- **Tier 5.6 group-by bucketizer cache** — fires when a serve-mode user reports slow repeated `--group-by owner|package`.
- **Tier 5.7 git subprocess collapse** — fires if git-subprocess time becomes measurable in incremental wall (Tier 2.3 mostly killed it).
- **Tier 6.1 RO connection pool** — fires when `mcp` / `serve` indexing 10k+ trees reports contention. Pool is scoped to long-running transports only, NOT one-shot CLI (per audit reconciliation).
- **Tier 6.2 CI dep vendoring** — fires after timing the existing CI install steps and confirming meaningful savings (currently unmeasured).

## Phase 5 — close the triangulation audit

Per [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit), the triangulation audit closes when Tier 1 + Tier 2 ship (done at Phase 1) AND surviving deferred items either ship or lift to `roadmap.md`.

- [ ] Add one `roadmap.md` backlog line consolidating Phase 4 deferrals: `**Perf-triangulation deferrals (trigger-gated)** — Tier 5.2/5.4/5.6/5.7/6.1/6.2 from audit 2026-05-17; each ships when its trigger fires (see audit doc for triggers).`
- [ ] Apply the re-derivable test from the closing-audit substrate variants: does a fresh audit today re-derive every finding from current code? If yes AND no source cites the audit doc by name → **delete** (no tombstones). If the methodology section (instrument before estimating) is unique policy → slim to that + add `Status: Closed` header.

## Methodology learnings (already in audit doc, recapped here)

The triangulation audit's `Methodology gaps` section records two lessons that should outlive the audit itself:

1. **Audit cost models should be falsifiable, not estimated.** The Tier 5.1 deferral predicted a `Map.get` hoist win that didn't materialise (~38 ms estimate; measurement showed 0 to slight regression). The actual win came from a PRAGMA-window analysis that wasn't in any of the 5 source audits. Future audits should ship `performance.now()` instrumentation around suspected hot spots BEFORE recommending refactors, gated by an env var (e.g. `CODEMAP_<phase>_PROFILE=1`).
2. **Profile reveals where time goes; estimates reveal where authors think time goes.** All 5 source audits assumed `bindings_ms` was dominated by `resolveBindings` (the loop). Profiling showed it's dominated by `persistBindings.insert` (the SQL INSERT). One profile-instrumented run would have caught this.

**Optional follow-up:** lift the two lessons into a Tier-2 rule (e.g. `.agents/rules/perf-audits-must-be-falsifiable.md`) or extend the [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md) skill so future audits inherit this discipline automatically. Out of scope for this plan; mention only.

## What NOT to do

- **Don't try Phase 3a / 3b items without their plan PR first.** They're each architectural problems worth their own grilling.
- **Don't pursue multi-DB / sharding.** Measurement-grounded conclusion: SQLite single-writer is the moat; horizontal scaling within that constraint is caching (Phase 3b), not parallelism. See audit doc § Reconciled disagreements + the Tier 5.1 empirical update.
- **Don't add more CPU workers beyond the existing default + env override.** Parse phase is sub-second on most corpora; diminishing returns; the [`docs/audits/2026-05-17-performance-architecture-triangulation.md`](../audits/2026-05-17-performance-architecture-triangulation.md) Tier 3.3 env knob covers the legitimate override case.
- **Don't retry Tier 5.1's predicted hoist (TypedArrays, no-imports fast-path) without profiling first.** The previous attempt was a dud; the audit's cost model was wrong.

## References

- [Triangulation audit](../audits/2026-05-17-performance-architecture-triangulation.md) — full design context, consensus matrix, per-tier rationale, methodology gaps.
- [`docs/benchmark.md` § Perf baseline](../benchmark.md#perf-baseline-regression-guardrail) — the regression-guard mechanism Phase 1's CI variance check uses.
- [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit) — Phase 5 substrate variants.
- [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — why each phase is its own focused PR rather than a megaproject.
- [`verify-after-each-step`](../../.agents/rules/verify-after-each-step.md) — why each commit in Phase 2 gets its own baseline run.
