# Performance architecture triangulation — 2026-05-17

**Status:** **Closed** (2026-05-18). Tier 1-4, Tier 5.1 / 5.3 / 5.5, and the perf-baseline CI guardrail shipped via PRs [#96](https://github.com/stainless-code/codemap/pull/96), [#99](https://github.com/stainless-code/codemap/pull/99), [#100](https://github.com/stainless-code/codemap/pull/100). Surviving deferrals (Tier 5.2 / 5.4 / 5.6 / 5.7, Tier 6.1 / 6.2) lifted to [`roadmap.md`](../roadmap.md). Per-item rationale + measurement deltas are re-derivable from `git log` + the source audit files below; this doc is slimmed to the **synthesis** and **decisions of record** that the individual source audits don't carry.

**Scope (original):** Synthesise the five independent perf/architecture audits authored 2026-05-17, cross-tabulate findings, reconcile disagreements, surface coverage gaps, recommend a triangulated execution order.

## What shipped

| Tier | Item                                                                                                                                                 | Where                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1.1  | Instrument bindings / cycles / re-export tail (`bindings_ms` / `module_cycles_ms` / `re_export_chains_ms`) + `CODEMAP_PERFORMANCE_JSON` env var      | #96 commit `b828cf2`                                                                      |
| 1.2  | Perf-baseline regression guardrail (`scripts/check-perf-baseline.ts` + CI job + docs)                                                                | #96 `b828cf2`; CI-baseline re-capture #99 `ebb862e`; promoted to hard gate #100 `c0cdf0e` |
| 2.1  | `collectFiles` glob `ignore` + single-call refactor (collect_ms -93%)                                                                                | #96 `dd40a16`                                                                             |
| 2.2  | `query_batch` single read-only connection                                                                                                            | #96 `dd40a16`                                                                             |
| 2.3  | Incremental double read+hash kill                                                                                                                    | #96 `dd40a16`                                                                             |
| 3.1  | Shared `countLines` helper                                                                                                                           | #96 `a34aa66`                                                                             |
| 3.2  | `queryRows` `query_only=1` parity (correctness hardening — the one user-visible behavior change)                                                     | #96 `a34aa66`                                                                             |
| 3.3  | `CODEMAP_PARSE_WORKERS` env override                                                                                                                 | #96 `a34aa66`                                                                             |
| 3.4  | `stmtCache` placeholder memo                                                                                                                         | #96 `a34aa66`                                                                             |
| 4.1  | SQLite `busy_timeout = 100`                                                                                                                          | #96 `c6a6905`                                                                             |
| 4.2  | Duplicate `createSchema` call dedupe                                                                                                                 | #96 `c6a6905`                                                                             |
| 4.3  | `localeCompare` → byte-order sort                                                                                                                    | #96 `c6a6905`                                                                             |
| 4.4  | `getAdapterForExtension` Map lookup                                                                                                                  | #96 `c6a6905`                                                                             |
| 5.3  | FTS5 batched delete                                                                                                                                  | #96 `f2fe8b5`                                                                             |
| 5.5  | `getAllFileHashes` hoist between `getChangedFiles` + `indexFiles`                                                                                    | #96 `f2fe8b5`                                                                             |
| 5.1  | **bindings_ms -33% on 2k-file corpus** — NOT the predicted Map.get hoist; profile-driven PRAGMA-window extension instead (see § Decisions of record) | #96 `3f9f377` (then `23301dc` after PII rewrite)                                          |

End-to-end full-rebuild wall: **-21% on this repo (340 files), -18% on a 2k-file external corpus**, all measured on a per-tier basis with bit-identical resolver output (stable-snapshot SHA verified).

## Surviving deferrals (lifted to roadmap, trigger-gated)

See [`roadmap.md`](../roadmap.md) for the consolidated entry. Triggers per item:

- **5.2 IPC encoding** — fires after a `parse_ms_pure_worker` instrumentation split shows IPC > ~30% of `parse_ms`. None today; per audit Tier 5.2 hypothesis (CBOR / transferables) needs IPC time to be measurable first.
- **5.4 `extractMarkers` lineMap reuse on TS/JS** — fires if marker extraction becomes hot on >10k-file trees. ~1ms on this repo; refactor scope > payoff today.
- **5.6 group-by bucketizer cache per root** — fires when a `mcp` / `serve` user reports slow repeated `query --group-by owner|package`. Niche, state-management complexity, no current pattern.
- **5.7 sync git subprocess collapse** — fires if git-subprocess time becomes measurable in incremental wall. Tier 2.3 mostly killed it; remaining 4 calls × <10ms each are marginal.
- **6.1 Persistent read-only connection pool** — fires when `mcp` / `serve` indexing 10k+ trees reports contention. **Scoped to long-running transports only**, NOT one-shot CLI (GPT-5.5's caveat).
- **6.2 CI dep install / `package-manager-detector` vendoring** — fires after timing existing CI install steps confirms meaningful savings; vendoring adds maintenance overhead.

---

## Sources (provenance — kept verbatim)

| Audit        | Path                                                                                                                             | Authoring model | Depth signal                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Codex**    | [`2026-05-17-performance-architecture-audit-codex-5.3.md`](./2026-05-17-performance-architecture-audit-codex-5.3.md)             | Codex 5.3       | Full file-coverage accounting (390 text-read, 22 symlinks); CI surfaces included                                        |
| **Kimi**     | [`2026-05-17-performance-architecture-audit-kimi-k2.5.md`](./2026-05-17-performance-architecture-audit-kimi-k2.5.md)             | Kimi K2.5       | Architecture overview heavy; verified all PRAGMA values + worker formula in source                                      |
| **Claude**   | [`2026-05-17-performance-architecture-audit-claude-opus-4-7.md`](./2026-05-17-performance-architecture-audit-claude-opus-4-7.md) | Claude Opus 4.7 | Two `--full --performance` runs measured; standalone `tinyglobby` micro-bench; deepest source coverage (33 files cited) |
| **Composer** | [`2026-05-17-performance-architecture-audit-composer.md`](./2026-05-17-performance-architecture-audit-composer.md)               | Composer        | Section-aware doc reads; deliberate non-duplication baseline for Claude's audit                                         |
| **GPT-5.5**  | [`2026-05-17-performance-architecture-audit-gpt-5.5.md`](./2026-05-17-performance-architecture-audit-gpt-5.5.md)                 | GPT-5.5         | Single `--full --performance` run + full `benchmark.ts` table; surfaced live SQLite-lock warning during audit           |

All five obeyed the same shared constraint set: no behaviour change, no schema slimming, no FTS5 default flip (per [`roadmap.md` Moat B](../roadmap.md) + [`README.md` Rule 6](../README.md)).

The per-model snapshots stay UNTOUCHED post-closure. References to the pre-Tier-2 `Bun.Glob`, pre-Tier-4 `localeCompare`, the 4-phase `IndexPerformanceReport`, etc. are correct _as of 2026-05-17_ — that's what each model saw. Audit lifecycle treats them as historical artifacts.

---

## Consensus matrix (verbatim — unique synthesis)

Every distinct finding across the five audits, with per-audit priority. Empty cell = not raised. Higher row = higher consensus. **This is the audit's main durable artifact: the only place that shows which audits agreed on what, and the only way to reconstruct it without re-reading all five sources.**

| #   | Finding                                                                       | Codex            | Kimi     | Claude                                                         | Composer | GPT-5.5                                 | Audits           |
| --- | ----------------------------------------------------------------------------- | ---------------- | -------- | -------------------------------------------------------------- | -------- | --------------------------------------- | ---------------- |
| 1   | Main-thread / worker→main IPC cost (existence)                                | P1 (FTS payload) | P2       | P2 (4.6)                                                       | P2       | P2                                      | **5**            |
| 2   | Shared `line_count` / double-newline-scan helper                              | —                | P1       | P2 (4.5)                                                       | P1       | —                                       | **3**            |
| 3   | Falsifiable benchmark CI                                                      | —                | P1       | —                                                              | P1       | P1                                      | **3**            |
| 4   | Bindings resolver memory + CPU scaling                                        | —                | P2       | P2 (4.7)                                                       | P2       | —                                       | **3**            |
| 5   | `queryRows` ↔ `executeQuery` `query_only=1` parity                            | —                | P3       | P3 (4.13 echo)                                                 | P3       | —                                       | **3**            |
| 6   | `stmtCache` eviction (LRU or placeholder pre-compute)                         | —                | P4       | P3 (4.12)                                                      | P4       | —                                       | **3**            |
| 7   | Worker pool configurability (env / dynamic)                                   | P1 (dynamic)     | P3 (env) | —                                                              | P3 (env) | —                                       | **3**            |
| 8   | `collectFiles` glob `ignore` + single-call                                    | —                | —        | **P0 (4.1, measured ~12.8× on glob, ~24% on cold-build wall)** | —        | P0                                      | **2**            |
| 9   | `query_batch` single read-only connection                                     | P0               | —        | —                                                              | —        | P0                                      | **2**            |
| 10  | Instrument bindings / cycles / re-export tail in `--performance`              | —                | —        | P1 (4.3, ~32% of `total_ms` invisible)                         | —        | P0                                      | **2**            |
| 11  | Incremental path: avoid double read+hash                                      | —                | —        | P1 (4.2)                                                       | —        | P1                                      | **2**            |
| 12  | Persistent read-only connection pool (long-running transports)                | —                | P3       | —                                                              | P3       | (deferred)                              | **2** + 1 caveat |
| 13  | Duplicate `createSchema` in `runCodemapIndex`                                 | P0               | —        | —                                                              | —        | —                                       | 1                |
| 14  | `--group-by owner\|package` bucketizer cache                                  | P0               | —        | —                                                              | —        | —                                       | 1                |
| 15  | Sync git subprocess collapse (`spawnSync`)                                    | P1               | —        | —                                                              | —        | —                                       | 1                |
| 16  | FTS worker payload amplification (`parsed.content` cross-thread)              | P1               | —        | —                                                              | —        | —                                       | 1                |
| 17  | CI: repeated `bun install` / `package-manager-detector` install               | P2               | —        | —                                                              | —        | —                                       | 1                |
| 18  | SQLite `busy_timeout` for benign writer collisions (`recency` lock seen live) | —                | —        | —                                                              | —        | **P1 (direct evidence from audit run)** | 1                |
| 19  | `localeCompare` → byte-order sort for ASCII paths                             | —                | —        | P2 (4.4)                                                       | —        | —                                       | 1                |
| 20  | `getAdapterForExtension` linear scan → `Map`                                  | —                | —        | P3 (4.8)                                                       | —        | —                                       | 1                |
| 21  | FTS5 batched delete (1-`db.run`-per-path today)                               | —                | —        | P3 (4.9)                                                       | —        | —                                       | 1                |
| 22  | `extractMarkers` lineMap reuse on TS/JS                                       | —                | —        | P3 (4.10)                                                      | —        | —                                       | 1                |
| 23  | `getAllFileHashes` hoist (shared between `getChangedFiles` + `indexFiles`)    | —                | —        | P3 (4.11)                                                      | —        | —                                       | 1                |

---

## Decisions of record

### Tier 5.1 — predicted Map.get hoist was wrong; PRAGMA-window extension shipped instead

The audit's predicted optimisation (per-file `Map.get` hoist saving the ~38ms it estimated from ~1.26M skipped lookups × ~30ns each) was **wrong** — tested both `ORDER BY file_path, id` SQL and JS-side `Map<file, Ref[]>` grouping variants on this repo (340 files) and a 2.1k-file external corpus; both showed 0 to slight regression. V8 already optimises hot `Map.get`; JS-side grouping overhead exceeded any savings.

**Profile-driven actual win:** `CODEMAP_BINDINGS_PROFILE` instrumentation revealed `bindings_ms` decomposes as `resolveBindings ≈ 17%` + `persistBindings.insert ≈ 83%` on a 2k-file corpus — the bottleneck was 243k row INSERTs with `foreign_keys=ON` + `synchronous=NORMAL` per row, NOT the resolver loop. Extending the existing bulk-INSERT PRAGMA-OFF window (already used during parallel parse+insert) through the bindings/cycles/re-exports phase saved **-33% `bindings_ms`** on the 2k-file corpus and **-27% here**. Behavior-preserved (stable-snapshot SHA bit-identical on both corpora).

This decision-of-record stays in this doc because the alternative (the predicted hoist) is now documented as a dead-end, sparing the next agent from re-running the same experiment. The "deeper optimisations (TypedArrays, no-imports fast-path)" the audit gated on a larger corpus are still untested and may be similarly off — see the methodology lesson below.

### Reconciled disagreements (with post-execution status)

| Topic                                   | Conflict                                                                                                                         | Resolution                                                                                                                                                    | Status                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Persistent RO connection pool**       | Kimi + Composer recommend; GPT-5.5 cautions                                                                                      | GPT-5.5's caveat is scoped _"for one-shot CLI"_ — no real conflict. Pool is fine for `mcp` / `serve`, not CLI.                                                | **Deferred to roadmap as Tier 6.1**                                      |
| **Worker pool change shape**            | Codex P1 (dynamic queue); Kimi + Composer P3 (env var, defaults unchanged)                                                       | Env var first (safer, defaults preserved). Dynamic queue stays hypothesis until benchmark CI proves the fixed-chunk model is the bottleneck on a real corpus. | **Env var shipped (Tier 3.3); dynamic queue still hypothesis**           |
| **`--performance` field naming**        | Claude: `bindings_ms` / `cycles_ms` / `re_export_chains_ms`; GPT-5.5: `bindings_ms` / `module_cycles_ms` / `re_export_chains_ms` | `module_cycles_ms` is more self-describing; mirrors the underlying `persistModuleCycles` function name.                                                       | **GPT-5.5 naming shipped (Tier 1.1)**                                    |
| **IPC encoding (CBOR / transferables)** | Claude P2 hypothesis; Composer + Kimi P2 (streaming inserts); GPT-5.5 P2 (defer to instrumentation)                              | All converge on "instrument before acting". No action without Tier 1 instrumentation showing IPC is a non-negligible fraction of `parse_ms`.                  | **Deferred to roadmap as Tier 5.2; trigger = IPC split instrumentation** |

---

## Methodology gaps (lessons surfaced by execution)

These lessons are why this doc isn't deleted outright — they're durable policy distilled from running the audit end-to-end, and they don't live anywhere else in the repo.

- **Audit cost models should be falsifiable, not estimated.** The Tier 5.1 deferral predicted a `Map.get` hoist win that didn't materialise; the actual win came from a PRAGMA-window analysis that wasn't in any of the five audits. Next audit pass: ship `performance.now()` instrumentation around suspected hot spots BEFORE recommending refactors, gated by an env var so it stays opt-in (e.g. `CODEMAP_<phase>_PROFILE=1`).
- **Profile reveals where time goes; estimates reveal where authors think time goes.** All five audits assumed `bindings_ms` was dominated by `resolveBindings` (the loop). It's dominated by `persistBindings` (the INSERT). One profile-instrumented run would have caught this.

These two lessons are candidates for a Tier-2 rule (`.agents/rules/perf-audits-must-be-falsifiable.md`) or an extension to [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md). Tracked but not yet acted on — promote when the next perf audit kicks off.

## Coverage gaps (next-audit fodder)

None of the five audits examined these — useful starting points if a follow-up audit is commissioned:

- **Resolver cost per import** — `oxc-resolver` calls during `resolveImports` are inside `insert_ms` today; not separately timed.
- **Hash algorithm choice** — `hashContent` uses SHA-256 (`src/hash.ts`). Non-crypto alternatives (xxHash, BLAKE3) would be a wash on small files, possibly meaningful on large monorepos. No audit benchmarked this.
- **Memory profiling under full rebuild** — heap snapshot during the `resolveBindings` tail would falsify (or confirm) the "TypedArrays for hot maps" sub-bullet in Composer 4.4 / Kimi 4.4.
- **File-system caching beyond hashes** — `readFileSync` results are not cached between `getChangedFiles` and `indexFiles` (row 11 partly addresses); deeper caching (e.g. parsed AST cache keyed by hash) is unexplored. **The biggest unshipped horizontal-scaling primitive** — drafted as a follow-up plan: see [`docs/plans/perf-triangulation-rollout.md`](../plans/perf-triangulation-rollout.md) Phase 3b.
- **`PRAGMA wal_autocheckpoint` tuning** — WAL is on, but checkpoint cadence is at default. No audit measured WAL growth during long-running watchers.

---

## References

- **Source audits:** see § Sources above. Snapshots; not updated.
- **Rollout plan:** [`docs/plans/perf-triangulation-rollout.md`](../plans/perf-triangulation-rollout.md) — phases 0-5; Phase 5 (audit closure) is what produced this slim.
- **Perf-baseline guardrail:** [`docs/benchmark.md § Perf baseline`](../benchmark.md#perf-baseline-regression-guardrail).
- **Closing-an-audit lifecycle:** [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit).
- **Constraints:** [`roadmap.md` Moat B](../roadmap.md), [`README.md` Rule 6](../README.md), [`architecture.md` § Schema versioning](../architecture.md#schema-versioning).
