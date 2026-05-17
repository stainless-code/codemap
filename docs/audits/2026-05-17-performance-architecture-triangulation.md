# Performance architecture triangulation — 2026-05-17

**Scope:** Synthesise the five independent perf/architecture audits authored 2026-05-17, cross-tabulate findings, reconcile disagreements, surface coverage gaps, recommend a triangulated execution order.

**Status:** Open meta-audit. Closes per [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit) once the Tier-1 + Tier-2 slices below ship and the surviving deferred items move to `roadmap.md`.

---

## Sources

| Audit        | Path                                                                                                                             | Authoring model | Depth signal                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Codex**    | [`2026-05-17-performance-architecture-audit-codex-5.3.md`](./2026-05-17-performance-architecture-audit-codex-5.3.md)             | Codex 5.3       | Full file-coverage accounting (390 text-read, 22 symlinks); CI surfaces included                                        |
| **Kimi**     | [`2026-05-17-performance-architecture-audit-kimi-k2.5.md`](./2026-05-17-performance-architecture-audit-kimi-k2.5.md)             | Kimi K2.5       | Architecture overview heavy; verified all PRAGMA values + worker formula in source                                      |
| **Claude**   | [`2026-05-17-performance-architecture-audit-claude-opus-4-7.md`](./2026-05-17-performance-architecture-audit-claude-opus-4-7.md) | Claude Opus 4.7 | Two `--full --performance` runs measured; standalone `tinyglobby` micro-bench; deepest source coverage (33 files cited) |
| **Composer** | [`2026-05-17-performance-architecture-audit-composer.md`](./2026-05-17-performance-architecture-audit-composer.md)               | Composer        | Section-aware doc reads; deliberate non-duplication baseline for Claude's audit                                         |
| **GPT-5.5**  | [`2026-05-17-performance-architecture-audit-gpt-5.5.md`](./2026-05-17-performance-architecture-audit-gpt-5.5.md)                 | GPT-5.5         | Single `--full --performance` run + full `benchmark.ts` table; surfaced live SQLite-lock warning during audit           |

All five obey the same shared constraint set: no behaviour change, no schema slimming, no FTS5 default flip (per [`roadmap.md` Moat B](../roadmap.md) + [`README.md` Rule 6](../README.md)).

---

## Consensus matrix

Every distinct finding across the five audits, with per-audit priority. Empty cell = not raised. Higher row = higher consensus.

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

## Triangulated priority order

Synthesised from consensus weight × measured leverage × risk. Each tier should ship in order; later tiers gate on earlier tier instrumentation.

### Tier 1 — Instrument first (prerequisites for everything below)

1. **Add `bindings_ms` / `cycles_ms` / `re_export_chains_ms` to `IndexPerformanceReport`** (row 10). Claude derived ~32% of `total_ms` is invisible today; GPT-5.5 derived ~203 ms unaccounted on the same repo. Pure instrumentation, trivial risk, additive JSON. **Without this, any "bindings is slow" claim is unfalsifiable.**
2. **Stand up benchmark CI** (row 3, also on [`roadmap.md`](../roadmap.md) backlog). Three audits cite it as the precondition for the riskier slices.

### Tier 2 — Highest-leverage measured wins, low risk

1. **`collectFiles` glob `ignore` + single-call refactor** (row 8). Claude measured ~24% cold-build wall reduction; GPT-5.5 independently flagged 260 ms as the largest measured phase. Validate via sorted-path-set diff before/after on `fixtures/minimal` and this repo.
2. **`query_batch` single read-only connection** (row 9). Codex + GPT-5.5 both P0. Preserve per-item `{error}` isolation; keep `PRAGMA query_only=1` on the batch handle.
3. **Incremental double read+hash elimination** (row 11). Two audits at P1; pure shape refactor on `getChangedFiles` → `Map<path,{source,hash}>` plumbed to `indexFiles`.

### Tier 3 — Three-audit consensus, low risk

1. **Shared `countUtf8Lines` helper** (row 2). Worker returns `lineMap` (or `lineCount`) so `extractFileData` skips the inline scan on TS/JS. Keep inline scan for text + CSS paths.
2. **`queryRows` `query_only=1` parity** (row 5). Correctness hardening; aligns programmatic `Codemap.query` with `executeQuery`.
3. **Worker pool env override** (row 7). `CODEMAP_PARSE_WORKERS` with documented cap/floor; defaults unchanged. (Codex's dynamic-queue variant is hypothesis-stage — defer.)
4. **`stmtCache` placeholder pre-compute + optional LRU** (row 6). Claude's diagnosis (tail-batch placeholder variation, not user SQL) is the actionable framing — pre-compute `Array(BATCH_SIZE).fill('(?,…)').join(',')` once at module load. LRU eviction is the fallback.

### Tier 4 — Single-audit, novel, evidence-backed

1. **SQLite `busy_timeout`** (row 18). Only GPT-5.5 flagged it, but with live evidence (`[recency] write failed: database is locked` during the audit run). Add a small timeout on the recency writer connection; don't blanket-apply to read paths without contention tests.
2. **Duplicate `createSchema` call dedupe in `runCodemapIndex`** (row 13). Codex unique, micro-fix, safe.
3. **`localeCompare` → byte-order sort** (row 19). Claude unique, measurable micro-win, ASCII path invariant verified.
4. **`getAdapterForExtension` → `Map` lookup** (row 20). Trivial cleanup; design-forward for the [`c9-plugin-layer.md`](../plans/c9-plugin-layer.md) registration surface.

### Tier 5 — Hypothesis-stage or scale-dependent (gate on Tier 1 instrumentation)

1. **Bindings resolver hoist / no-imports fast-path** (rows 4 + 23). Three audits agree on the existence; act only after `bindings_ms` confirms the wall cost on this repo and one larger corpus.
   - **Empirical update (PR #96 commit `3f9f377`):** the audit's predicted optimisation (per-file `Map.get` hoist saving the ~38ms it estimated from ~1.26M skipped lookups × ~30ns each) was **wrong** — tested both `ORDER BY file_path, id` SQL and JS-side `Map<file, Ref[]>` grouping variants on this repo (340 files) and a 2.1k-file external corpus; both showed 0 to slight regression. V8 already optimises hot `Map.get`; JS-side grouping overhead exceeded any savings.
   - **Profile-driven actual win:** `CODEMAP_BINDINGS_PROFILE` instrumentation revealed `bindings_ms` decomposes as `resolveBindings ≈ 17%` + `persistBindings.insert ≈ 83%` on a 2k-file corpus — the bottleneck was 243k row INSERTs with `foreign_keys=ON` + `synchronous=NORMAL` per row, NOT the resolver loop. Extending the existing bulk-INSERT PRAGMA-OFF window (already used during parallel parse+insert) through the bindings/cycles/re-exports phase saved **-33% `bindings_ms`** on the 2k-file corpus and **-27% here**. Behavior-preserved (stable-snapshot SHA bit-identical on both corpora).
   - **Lesson for future audits:** the audit's cost model was estimated, not measured. The "deeper optimisations (TypedArrays, no-imports fast-path)" the audit gated on a larger corpus are still untested and may be similarly off. Next audit: include a `performance.now()`-instrumented profile pass on a representative corpus before recommending micro-optimisations.
2. **Main-thread / IPC encoding spike** (row 1). All five audits touch this; none agree on the action. GPT-5.5's framing wins: instrument first (split `parse_ms` into pure-worker vs IPC), then choose between FTS-payload reduction (Codex), streaming inserts (Kimi/Composer), or CBOR-transferred batches (Claude hypothesis).
3. **FTS5 batched delete** (row 21). Watcher-only path; payoff scales with `git checkout` event size.
4. **`extractMarkers` lineMap reuse** (row 22). Small win; depends on TS/JS path having the lineMap already.
5. **`getAllFileHashes` hoist** (row 23). Scale-dependent (Claude estimates ~7 MB at 100k files; sub-ms today on this repo).
6. **Group-by bucketizer cache** (row 14). Codex unique; helps when `query --group-by owner|package` is called repeatedly in one process.
7. **Sync git subprocess collapse** (row 15). Codex unique; incremental-only path.

### Tier 6 — Deliberately deferred (caveat applies)

1. **Persistent read-only connection pool** (row 12). Kimi + Composer recommend; GPT-5.5 explicitly defers _"for one-shot CLI until MCP/HTTP-specific lifecycle tests prove it is safe"_. **Reconciled:** acceptable behind a long-running transport (`mcp-server`, `http-server`) where lifecycle is owned; do not retrofit for `cli` paths.
2. **CI dep install / detector vendoring** (row 17). Codex unique; CI scope, not runtime; ship only after CI timing comparison demonstrates the gain is worth the maintenance overhead.

---

## Reconciled disagreements

| Topic                                   | Conflict                                                                                                                         | Resolution                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Persistent RO connection pool**       | Kimi + Composer recommend; GPT-5.5 cautions                                                                                      | GPT-5.5's caveat is scoped _"for one-shot CLI"_ — no real conflict. Pool is fine for `mcp` / `serve`, not CLI.                                                |
| **Worker pool change shape**            | Codex P1 (dynamic queue); Kimi + Composer P3 (env var, defaults unchanged)                                                       | Env var first (safer, defaults preserved). Dynamic queue stays hypothesis until benchmark CI proves the fixed-chunk model is the bottleneck on a real corpus. |
| **`--performance` field naming**        | Claude: `bindings_ms` / `cycles_ms` / `re_export_chains_ms`; GPT-5.5: `bindings_ms` / `module_cycles_ms` / `re_export_chains_ms` | Mechanical — choose one and ship. `module_cycles_ms` is more self-describing; mirrors the underlying `persistModuleCycles` function name.                     |
| **IPC encoding (CBOR / transferables)** | Claude P2 hypothesis; Composer + Kimi P2 (streaming inserts); GPT-5.5 P2 (defer to instrumentation)                              | All converge on "instrument before acting". No action without Tier 1 instrumentation showing IPC is a non-negligible fraction of `parse_ms`.                  |

---

## Methodology gaps (lessons surfaced by execution)

- **Audit cost models should be falsifiable, not estimated.** The Tier 5.1 deferral predicted a `Map.get` hoist win that didn't materialise; the actual win came from a PRAGMA-window analysis that wasn't in any of the five audits. Next audit pass: ship `performance.now()` instrumentation around suspected hot spots BEFORE recommending refactors, gated by an env var so it stays opt-in (e.g. `CODEMAP_<phase>_PROFILE=1`).
- **Profile reveals where time goes; estimates reveal where authors think time goes.** All five audits assumed `bindings_ms` was dominated by `resolveBindings` (the loop). It's dominated by `persistBindings` (the INSERT). One profile-instrumented run would have caught this.

## Coverage gaps (next-audit fodder)

None of the five audits examine:

- **Resolver cost per import** — `oxc-resolver` calls during `resolveImports` are inside `insert_ms` today; not separately timed.
- **Hash algorithm choice** — `hashContent` uses SHA-256 (`src/hash.ts`). Non-crypto alternatives (xxHash, BLAKE3) would be a wash on small files, possibly meaningful on large monorepos. No audit benchmarked this.
- **Memory profiling under full rebuild** — heap snapshot during the `resolveBindings` tail would falsify (or confirm) the "TypedArrays for hot maps" sub-bullet in Composer 4.4 / Kimi 4.4.
- **File-system caching beyond hashes** — `readFileSync` results are not cached between `getChangedFiles` and `indexFiles` (row 11 partly addresses); deeper caching (e.g. parsed AST cache keyed by hash) is unexplored.
- **`PRAGMA wal_autocheckpoint` tuning** — WAL is on, but checkpoint cadence is at default. No audit measured WAL growth during long-running watchers.

---

## Recommended first slice

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.mdc), the smallest end-to-end slice that earns Tier 1 + de-risks Tier 2:

1. **Add `bindings_ms` + `module_cycles_ms` + `re_export_chains_ms` to `IndexPerformanceReport`** + render under `--performance`. Pure instrumentation, additive JSON, no consumer breakage.
2. **Commit + re-run `bun src/index.ts --full --performance`** on this repo. Confirm reported phases reconcile with `total_ms` within rounding.
3. **Snapshot today's numbers** as the baseline before Tier 2's `collectFiles` refactor lands.

That gives one shippable PR, validates the instrumentation, and produces a falsifiable baseline against which every Tier 2+ slice is measured.

---

## References

- Source audits: see § Sources.
- Lifecycle: [`docs-governance` § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit).
- Constraints: [`roadmap.md` Moat B](../roadmap.md), [`README.md` Rule 6](../README.md), [`architecture.md` § Schema versioning](../architecture.md#schema-versioning).
