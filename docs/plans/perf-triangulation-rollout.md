# Perf-triangulation rollout

**Status:** Phases 0-2 + Phase 5 **shipped**; Phase 3 **open** (parse-insert + ast-cache plan PRs); Phase 4 **closed** (deferrals in [`roadmap.md`](../roadmap.md)). (via PRs [#95](https://github.com/stainless-code/codemap/pull/95) audit docs · [#96](https://github.com/stainless-code/codemap/pull/96) Tier 1-5 + Tier 5.1 · [#99](https://github.com/stainless-code/codemap/pull/99) CI-runner baseline · [#100](https://github.com/stainless-code/codemap/pull/100) hard gate · [#101](https://github.com/stainless-code/codemap/pull/101) docs refresh · [#102](https://github.com/stainless-code/codemap/pull/102) audit closure · [#103](https://github.com/stainless-code/codemap/pull/103) Phase 2). **Hard gate superseded by [#137](https://github.com/stainless-code/codemap/pull/137)** — perf baseline is local + weekly scheduled only (see [`benchmark.md` § Perf baseline](../benchmark.md#perf-baseline-regression-guardrail)). Surviving deferrals (Tier 5.2 / 5.4 / 5.6 / 5.7 / 6.1 / 6.2) lifted to [`roadmap.md`](../roadmap.md). Phase 3 open; Phase 4 closed (deferrals lifted to roadmap).

**Provenance:** Synthesis + execution of 5 independent perf/architecture audits authored 2026-05-17 by Codex 5.3, Kimi K2.5, Claude Opus 4.7, Composer, and GPT-5.5. All five obeyed the same constraint set: **no behavior change, no schema slimming, no FTS5 default flip** (per [`roadmap.md` Moat B](../roadmap.md) + [`README.md` Rule 6](../README.md)). Per-model audit text was consolidated into this doc on 2026-05-18; full original text recoverable via `git show cc28bce -- docs/audits/2026-05-17-performance-architecture-audit-*.md`.

---

## Sources (provenance — verified)

| Audit        | Authoring model | Depth signal                                                                                                                |
| ------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Codex**    | Codex 5.3       | Full file-coverage accounting (390 text-read, 22 symlinks); CI surfaces included                                            |
| **Kimi**     | Kimi K2.5       | Architecture overview heavy; verified all PRAGMA values + worker formula in source                                          |
| **Claude**   | Claude Opus 4.7 | Two `--full --performance` runs measured; standalone `tinyglobby` micro-bench; deepest source coverage (33 src files cited) |
| **Composer** | Composer        | Section-aware doc reads; deliberate non-duplication baseline for Claude's audit                                             |
| **GPT-5.5**  | GPT-5.5         | Single `--full --performance` run + full `benchmark.ts` table; surfaced live SQLite-lock warning during audit               |

---

## What shipped

Live inventory: [`benchmark.md` § Perf baseline](../benchmark.md#perf-baseline-regression-guardrail) + `scripts/check-perf-baseline.ts`. Key milestones: Tier 1.1 instrumentation (`bindings_ms` / `module_cycles_ms` / `re_export_chains_ms`), Tier 2.1 glob `ignore`, Tier 3.2 `query_only=1` parity, Tier 5.1 PRAGMA-window bindings win (not Map hoist — see § Decisions of record), Phase 2 PRAGMA `journal_mode=OFF` bulk window ([#103](https://github.com/stainless-code/codemap/pull/103)). Hard gate demoted to weekly scheduled ([#137](https://github.com/stainless-code/codemap/pull/137)).

**Consensus matrix (5 audits):** archived — `git show cc28bce -- docs/audits/2026-05-17-performance-architecture-audit-*.md`. Surviving deferrals: [`roadmap.md` § Perf-triangulation deferrals](../roadmap.md#perf-triangulation-deferrals-trigger-gated).

## Decisions of record

### Tier 5.1 — predicted Map.get hoist was wrong; PRAGMA-window extension shipped instead

The audit's predicted optimisation (per-file `Map.get` hoist saving the ~38ms it estimated from ~1.26M skipped lookups × ~30ns each) was **wrong** — tested both `ORDER BY file_path, id` SQL and JS-side `Map<file, Ref[]>` grouping variants on this repo (340 files) and a 2.1k-file external corpus; both showed 0 to slight regression. V8 already optimises hot `Map.get`; JS-side grouping overhead exceeded any savings.

**Profile-driven actual win:** Bindings-phase profiling (`bindings_ms` decomposition instrumentation; no longer a public env var) revealed `bindings_ms` decomposes as `resolveBindings ≈ 17%` + `persistBindings.insert ≈ 83%` on a 2k-file corpus — the bottleneck was 243k row INSERTs with `foreign_keys=ON` + `synchronous=NORMAL` per row, NOT the resolver loop. Extending the existing bulk-INSERT PRAGMA-OFF window (already used during parallel parse+insert) through the bindings/cycles/re-exports phase saved **-33% `bindings_ms`** on the 2k-file corpus and **-27% here**. Behavior-preserved (stable-snapshot SHA bit-identical on both corpora).

The "deeper optimisations (TypedArrays, no-imports fast-path)" the original audit gated on a larger corpus are still untested and may be similarly off — see § Methodology gaps below.

### Reconciled disagreements (with post-execution status)

| Topic                                   | Conflict                                                                                                                         | Resolution                                                                                                     | Status                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Persistent RO connection pool**       | Kimi + Composer recommend; GPT-5.5 cautions                                                                                      | GPT-5.5's caveat is scoped _"for one-shot CLI"_ — no real conflict. Pool is fine for `mcp` / `serve`, not CLI. | **Deferred (Tier 6.1 trigger-gated)**                          |
| **Worker pool change shape**            | Codex P1 (dynamic queue); Kimi + Composer P3 (env var, defaults unchanged)                                                       | Env var first (safer, defaults preserved). Dynamic queue stays hypothesis.                                     | **Env var shipped (Tier 3.3); dynamic queue still hypothesis** |
| **`--performance` field naming**        | Claude: `bindings_ms` / `cycles_ms` / `re_export_chains_ms`; GPT-5.5: `bindings_ms` / `module_cycles_ms` / `re_export_chains_ms` | `module_cycles_ms` more self-describing (mirrors `persistModuleCycles`)                                        | **GPT-5.5 naming shipped (Tier 1.1)**                          |
| **IPC encoding (CBOR / transferables)** | Claude P2 hypothesis; Composer + Kimi P2 (streaming inserts); GPT-5.5 P2 (defer to instrumentation)                              | All converge on "instrument before acting"                                                                     | **Deferred (Tier 5.2 trigger-gated)**                          |

---

## Methodology gaps (DURABLE — lift to `.agents/lessons.md` when this plan retires)

These lessons came out of running the audit end-to-end. They are durable policy and don't live anywhere else in the repo. When this plan retires per the standard plan lifecycle, lift this section to `.agents/lessons.md` (or extend [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md)) so future audits inherit the discipline.

- **Audit cost models should be falsifiable, not estimated.** The Tier 5.1 deferral predicted a `Map.get` hoist win that didn't materialise (~38ms estimate; measurement showed 0 to slight regression). The actual win came from a PRAGMA-window analysis that wasn't in any of the 5 source audits. Future audits should ship `performance.now()` instrumentation around suspected hot spots BEFORE recommending refactors, gated by an env var so it stays opt-in (e.g. `CODEMAP_<phase>_PROFILE=1`).
- **Profile reveals where time goes; estimates reveal where authors think time goes.** All five source audits assumed `bindings_ms` was dominated by `resolveBindings` (the loop). Profiling showed it's dominated by `persistBindings.insert` (the SQL INSERT). One profile-instrumented run would have caught this.
- **Never fabricate quantitative explanations to rationalize surprising data.** When a CI / perf / benchmark number is unexpected, the failure mode is to invent a plausible-sounding cause without verification. Already codified in [`.agents/lessons.md`](../../.agents/lessons.md) (PR #105) after a `+8 doc files` fabrication landed in PR #104's body to explain a surprising +71ms CI delta; actual delta was 1 file.

---

## Coverage gaps (next-audit fodder)

None of the five source audits examined these — useful starting points if a follow-up audit is commissioned:

- **Resolver cost per import** — `oxc-resolver` calls during `resolveImports` are inside `insert_ms` today; not separately timed.
- **Hash algorithm choice** — `hashContent` uses SHA-256 (`src/hash.ts`). Non-crypto alternatives (xxHash, BLAKE3) would be a wash on small files, possibly meaningful on large monorepos. No audit benchmarked this.
- **Memory profiling under full rebuild** — heap snapshot during the `resolveBindings` tail would falsify (or confirm) the "TypedArrays for hot maps" sub-bullet from Composer + Kimi.
- **File-system caching beyond hashes** — `readFileSync` results not cached between `getChangedFiles` and `indexFiles` (row 11 partly addresses); deeper caching (e.g. parsed AST cache keyed by hash) is unexplored. **Biggest unshipped horizontal-scaling primitive** — Phase 3b targets this.
- **`PRAGMA wal_autocheckpoint` tuning** — WAL is on, but checkpoint cadence is at default. No audit measured WAL growth during long-running watchers.

---

## Surviving deferrals (lifted to `roadmap.md`, trigger-gated)

| Item                                                          | Trigger                                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **5.2 IPC encoding (CBOR / transferables)**                   | After a `parse_ms_pure_worker` instrumentation split shows IPC > ~30% of `parse_ms`. None today; needs IPC time measurable first.  |
| **5.4 `extractMarkers` lineMap reuse on TS/JS**               | If marker extraction becomes hot on >10k-file trees. ~1ms on this repo; refactor scope > payoff today.                             |
| **5.6 group-by bucketizer cache per root**                    | When a `mcp` / `serve` user reports slow repeated `query --group-by owner                                                          | package`. Niche, state-management complexity, no current pattern. |
| **5.7 sync git subprocess collapse**                          | If git-subprocess time becomes measurable in incremental wall. Tier 2.3 mostly killed it; remaining 4 calls × <10ms each marginal. |
| **6.1 Persistent read-only connection pool**                  | When `mcp` / `serve` indexing 10k+ trees reports contention. **Scoped to long-running transports only**, NOT one-shot CLI.         |
| **6.2 CI dep install / `package-manager-detector` vendoring** | After timing existing CI install steps confirms meaningful savings.                                                                |

See [`roadmap.md`](../roadmap.md) for the consolidated backlog entry.

---

## Phases — execution sequence

- **Phases 0–2, 5:** shipped (see § What shipped). Checklist archaeology: `git log --follow -- docs/plans/perf-triangulation-rollout.md`.
- **Phase 3:** open — plan PRs for `parse-insert-pipeline.md` and `ast-cache.md` before code (see below).
- **Phase 4:** closed — trigger-gated items in roadmap.

### Phase 3 — plan PRs before code (architectural changes) — pending

Each is a **docs-only PR** that lands a `docs/plans/<name>.md` for design review. No implementation until plan approved. Real architectural changes — a wrong design here means slow rollback.

#### Phase 3a — `docs/plans/parse-insert-pipeline.md`

Overlap parse and insert phases. Today: workers finish all parsing → main thread sorts → main thread inserts. Pipelining: as worker chunks complete, main starts inserting that chunk while later workers parse. Theoretical save: ~300-500ms on big trees.

Open questions to settle in the plan:

- Approximate vs exact sort order — B-tree locality requires monotonic insert order, not strictly sorted. Pipelining means insert starts before final sort completes; does monotonic-within-chunk suffice?
- One transaction per chunk vs one big transaction wrapping all inserts.
- Error-isolation per chunk (a parse failure in one chunk shouldn't roll back inserts of earlier chunks).
- `IndexPerformanceReport.insert_ms` semantics when phases overlap — wall time or sum of insert work?
- Worker → main IPC encoding (Tier 5.2 hypothesis: CBOR / transferables). Pre-requisite: ship `parse_ms_pure_worker` timer split first so IPC fraction becomes measurable.

#### Phase 3b — `docs/plans/ast-cache.md`

The biggest unshipped horizontal-scaling primitive. Hash-keyed cache of `ParsedFile` rows → skip re-parse on hash hit. Massive win for big trees with low churn (typical CI watch loop, monorepo `git pull` that doesn't touch most files).

Open questions:

- Cache substrate: `.codemap/parse-cache/<hash>.json` (file per row) vs new `parsed_cache` table in `index.db` vs sidecar `index-cache.db`.
- Invalidation keys: `content_hash` necessary but not sufficient. Also: `SCHEMA_VERSION`, parser version (oxc release), adapter version, `fts5_enabled` toggle, any extractor-affecting config.
- Cache size management: LRU vs manual prune (`codemap cache prune`) vs unbounded. Disk-space tradeoff estimate: ~100-500 bytes per row × millions of rows on big trees.
- Cache hit semantics in full rebuild vs incremental.
- Cold-start cost on first run (no cache yet) — no regression vs today.
- Cache poisoning: detection + recovery.
- Interaction with the worker pool: workers consult cache before parsing; main reconciles.

## What NOT to do

- **Don't try Phase 3a / 3b items without their plan PR first.** They're each architectural problems worth their own grilling.
- **Don't pursue multi-DB / sharding.** Measurement-grounded conclusion: SQLite single-writer is the moat; horizontal scaling within that constraint is caching (Phase 3b), not parallelism. See § Decisions of record + Tier 5.1 empirical update.
- **Don't add more CPU workers beyond the existing default + env override.** Parse phase is sub-second on most corpora; diminishing returns. Tier 3.3's env knob covers the legitimate override case.
- **Don't retry Tier 5.1's predicted hoist (TypedArrays, no-imports fast-path) without profiling first.** The previous attempt was a dud; the audit's cost model was wrong (see § Methodology gaps).

---

## References

- [`docs/benchmark.md` § Perf baseline](../benchmark.md#perf-baseline-regression-guardrail) — the live regression guardrail this plan stood up.
- [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit) — substrate variants used to slim the triangulation into this consolidation.
- [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — why each phase is its own focused PR.
- [`verify-after-each-step`](../../.agents/rules/verify-after-each-step.md) — why each commit got its own baseline run.
- [`.agents/lessons.md`](../../.agents/lessons.md) — methodology lessons codified beyond this plan's lifetime (no-fabrication discipline + the perf-audit lessons in § Methodology gaps should lift here when the plan retires).
- **Full original audit text** (5 per-model + 1 triangulation, ~1900 lines total): recoverable via `git show cc28bce -- docs/audits/2026-05-17-performance-architecture-*.md`. The per-model unique measurement evidence + the consensus matrix + all decisions of record + methodology gaps + coverage gaps live inline above; the git-history pointer is for archaeology only.
