# Perf-triangulation rollout

**Status:** Phases 0-2 shipped (via PRs [#95](https://github.com/stainless-code/codemap/pull/95) audit docs · [#96](https://github.com/stainless-code/codemap/pull/96) Tier 1-5 + Tier 5.1 · [#99](https://github.com/stainless-code/codemap/pull/99) CI-runner baseline · [#100](https://github.com/stainless-code/codemap/pull/100) hard gate · [#101](https://github.com/stainless-code/codemap/pull/101) docs refresh · [#102](https://github.com/stainless-code/codemap/pull/102) audit closure · [#103](https://github.com/stainless-code/codemap/pull/103) Phase 2). Surviving deferrals (Tier 5.2 / 5.4 / 5.6 / 5.7 / 6.1 / 6.2) lifted to [`roadmap.md`](../roadmap.md). Phases 3-5 pending.

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

| Tier      | Item                                                                                                                                                       | Commit on `main`                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1.1       | Instrument bindings / cycles / re-export tail (`bindings_ms` / `module_cycles_ms` / `re_export_chains_ms`) + `CODEMAP_PERFORMANCE_JSON` env var            | `cc8daed` (#96)                                                                     |
| 1.2       | Perf-baseline regression guardrail (`scripts/check-perf-baseline.ts` + CI job + docs)                                                                      | `cc8daed` (#96); CI baseline re-capture `ebb862e` (#99); hard gate `c0cdf0e` (#100) |
| 2.1       | `collectFiles` glob `ignore` + single-call refactor (collect_ms -93%)                                                                                      | `cc8daed` (#96)                                                                     |
| 2.2       | `query_batch` single read-only connection                                                                                                                  | `cc8daed` (#96)                                                                     |
| 2.3       | Incremental double read+hash kill                                                                                                                          | `cc8daed` (#96)                                                                     |
| 3.1       | Shared `countLines` helper                                                                                                                                 | `cc8daed` (#96)                                                                     |
| 3.2       | `queryRows` `query_only=1` parity (correctness hardening — the one user-visible behavior change)                                                           | `cc8daed` (#96)                                                                     |
| 3.2b      | `printQueryResult` `query_only=1` parity — ad-hoc `codemap query "<SQL>"` CLI path (closes last read-only gap vs `executeQuery`)                           | #107                                                                                |
| 3.3       | `CODEMAP_PARSE_WORKERS` env override                                                                                                                       | `cc8daed` (#96)                                                                     |
| 3.4       | `stmtCache` placeholder memo                                                                                                                               | `cc8daed` (#96)                                                                     |
| 4.1       | SQLite `busy_timeout = 100`                                                                                                                                | `cc8daed` (#96)                                                                     |
| 4.2       | Duplicate `createSchema` call dedupe                                                                                                                       | `cc8daed` (#96)                                                                     |
| 4.3       | `localeCompare` → byte-order sort                                                                                                                          | `cc8daed` (#96)                                                                     |
| 4.4       | `getAdapterForExtension` Map lookup                                                                                                                        | `cc8daed` (#96)                                                                     |
| 5.3       | FTS5 batched delete                                                                                                                                        | `cc8daed` (#96)                                                                     |
| 5.5       | `getAllFileHashes` hoist between `getChangedFiles` + `indexFiles`                                                                                          | `cc8daed` (#96)                                                                     |
| **5.1**   | **bindings_ms -33% on 2k-file corpus** — NOT the predicted Map.get hoist (see § Decisions of record below); profile-driven PRAGMA-window extension instead | `cc8daed` (#96)                                                                     |
| Phase 2.1 | `PRAGMA journal_mode = OFF` during full-rebuild bulk-insert window                                                                                         | `be78b6c` (#103)                                                                    |
| Phase 2.2 | `INSERT` (not `INSERT OR REPLACE`) on full-rebuild bulk paths                                                                                              | `be78b6c` (#103)                                                                    |
| Phase 2.3 | Per-table `BATCH_SIZE = min(5000, floor(32766/col_count))` (10× wider for 4-col tables)                                                                    | `be78b6c` (#103)                                                                    |

---

## Consensus matrix

Every distinct finding across the five source audits, with per-audit priority. Empty cell = not raised. **This is the audit synthesis's main durable artifact: the only place that shows which audits agreed on what, and the only way to reconstruct it without re-reading all five originals.**

| #   | Finding                                                                       | Codex            | Kimi     | Claude                                                         | Composer | GPT-5.5                                 | Audits           |
| --- | ----------------------------------------------------------------------------- | ---------------- | -------- | -------------------------------------------------------------- | -------- | --------------------------------------- | ---------------- |
| 1   | Main-thread / worker→main IPC cost (existence)                                | P1 (FTS payload) | P2       | P2 (4.6)                                                       | P2       | P2                                      | **5**            |
| 2   | Shared `line_count` / double-newline-scan helper                              | —                | P1       | P2 (4.5)                                                       | P1       | —                                       | **3**            |
| 3   | Falsifiable benchmark CI                                                      | —                | P1       | —                                                              | P1       | P1                                      | **3**            |
| 4   | Bindings resolver memory + CPU scaling                                        | —                | P2       | P2 (4.7)                                                       | P2       | —                                       | **3**            |
| 5   | `queryRows` ↔ `executeQuery` `query_only=1` parity                            | —                | P3       | P3 (4.13 echo)                                                 | P3       | —                                       | **3**            |
| 5b  | `printQueryResult` ↔ `executeQuery` `query_only=1` parity (CLI ad-hoc SQL)    | —                | —        | —                                                              | —        | —                                       | **1** (#107)     |
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

## Historical evidence (preserved verbatim from source audits)

These numbers ground the audit's measurement claims and are not reproducible by re-running today (different code state, different machine). Useful as historical comparison points.

### Pre-perf-work baseline (GPT-5.5 audit, 2026-05-17)

`bun src/index.ts --full --performance` on this repo at the audit-time commit:

| Phase         |      ms |
| ------------- | ------: |
| collect       |     260 |
| parse         |     162 |
| insert        |     163 |
| index_create  |      68 |
| **index_run** | **596** |

`bun src/benchmark.ts` at the same commit:

| Area                                      | Result                |
| ----------------------------------------- | --------------------- |
| Indexed queries vs traditional scan total | 43.98 ms vs 462.92 ms |
| Traditional bytes read across scenarios   | ~6.9 MB               |
| Reindex benchmark, targeted 3 files       | avg 185.66 ms         |
| Reindex benchmark, incremental no changes | avg 202.79 ms         |
| Reindex benchmark, full rebuild           | avg 705.84 ms         |

Indexed substrate at that time: 340 files, 6,593 symbols, 42,598 references, 32,144 bindings, 393 dependencies.

### Claude's `tinyglobby` micro-bench (the evidence behind Tier 2.1)

Standalone `bun -e` micro-bench from repo root at the audit-time commit:

| Strategy                                                                                                  | Paths returned             |    Wall time |
| --------------------------------------------------------------------------------------------------------- | -------------------------- | -----------: |
| Current (5 calls, no `ignore`)                                                                            | 6,838 (post-filter to 340) | **198.6 ms** |
| Single call, all 5 patterns + `ignore: ['**/node_modules/**','**/.git/**','**/dist/**','**/.codemap/**']` | 366                        |  **15.5 ms** |

This was the empirical basis for Tier 2.1's design (single-call + `ignore` + tinyglobby on both runtimes since `Bun.Glob` lacks `ignore`).

### Codex hotspot SQL queries (validation kit for future perf audits)

```sql
-- Largest files
SELECT path, size, line_count, language FROM files ORDER BY size DESC LIMIT 20;

-- Complexity hotspots
SELECT name, file_path, complexity, body_line_count, nesting_depth, param_count
FROM symbols WHERE complexity IS NOT NULL
ORDER BY complexity DESC, body_line_count DESC LIMIT 20;

-- node:child_process concentration (a perf-relevant subprocess signal)
SELECT file_path, source FROM imports
WHERE source='node:child_process' ORDER BY file_path;
```

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

### Phase 0 — pre-merge housekeeping ✅

- [x] **Changeset** for PR #96. Shipped in [#96](https://github.com/stainless-code/codemap/pull/96).
- [x] PR #95 + #96 marked ready for review, merged.

### Phase 1 — merge + CI variance characterisation ✅

- [x] Merged [#95](https://github.com/stainless-code/codemap/pull/95) (audit docs) + [#96](https://github.com/stainless-code/codemap/pull/96) (Tier 1-5 + 5.1 code).
- [x] **CI variance characterised on first run** — within-run variance ~5% (882/838/866 ms total across 3 internal samples), well inside the 25% threshold. Issue was systematic CI-slowness (2-4× vs local), not noise.
- [x] **Re-baselined from CI runner medians** in [#99](https://github.com/stainless-code/codemap/pull/99) — local was the wrong baseline source.
- [x] **Promoted `📈 Perf baseline (self-index)` to hard gate** in [#100](https://github.com/stainless-code/codemap/pull/100) — dropped `continue-on-error: true`, added to `ci-complete`'s required-jobs list, and added to branch protection's `required_status_checks.contexts` via `gh api`.

### Phase 2 — PRAGMA + INSERT tuning trio ✅

Shipped in [#103](https://github.com/stainless-code/codemap/pull/103) as three focused commits. See § What shipped above for per-sub-item refs.

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

### Phase 4 — trigger-gated deferrals (not on the critical path)

See § Surviving deferrals above + [`roadmap.md`](../roadmap.md) for the canonical list.

### Phase 5 — close the triangulation audit ✅

- [x] Added one `roadmap.md` backlog line consolidating Phase 4 deferrals with explicit trigger conditions. Shipped in [#102](https://github.com/stainless-code/codemap/pull/102).
- [x] **Consolidated all audit content into this plan** (PR shipping this consolidation) so the audit substrate doesn't drift apart from the rollout substrate. Per-model source audits and the triangulation file deleted from `docs/audits/`; full text recoverable via git history at SHA `cc28bce`.

---

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
