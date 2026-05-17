# Composer — performance-oriented architecture audit & plan

**Authoring model:** Composer (Cursor agent).  
**Date:** 2026-05-17.  
**Scope:** Performance improvements **without intentional functional change**. All architectural claims below are tied to repo source or shipped docs unless marked _hypothesis_.

---

## 1. Methodology & coverage honesty

### 1.1 Path inventory (complete)

Enumerate-only verification (no gaps in directory listing):

| Tree       | Files                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `.agents/` | **27** files (`rules/*.md`, `skills/**/SKILL.md`, supporting `.md`/`.sh`) |
| `docs/`    | **18** files (`*.md`, `plans/*.md`, `research/*.md`, `.gitkeep`)          |

### 1.2 What was read in full vs in sections

| Material                                          | Depth                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md`                            | **Section-aware read:** TOC via heading grep; continuous read § Overview–§ Schema introduction; § Incremental Updates; § Full Rebuild Optimizations through § SQLite Performance Configuration (Covering indexes). Middle schema tables skimmed/not required for perf audit. |
| `docs/benchmark.md`                               | **Full.**                                                                                                                                                                                                                                                                    |
| `docs/glossary.md`                                | **Full** (perf-adjacent: batch insert, WAL, coverings, FTS5 note, MCP DB lifecycle).                                                                                                                                                                                         |
| `docs/roadmap.md`                                 | **Full** (Moat **B**: schema breadth vs theoretical perf simplification — constraint on recommendations).                                                                                                                                                                    |
| `docs/why-codemap.md`                             | Partial (speed/token sections).                                                                                                                                                                                                                                              |
| `docs/agents.md`                                  | Partial (agents surface; minimal perf relevance).                                                                                                                                                                                                                            |
| `docs/research/non-goals-reassessment-2026-05.md` | Partial (FTS / shipped inventory).                                                                                                                                                                                                                                           |
| Other `docs/`                                     | Not line-by-line; not material to indexer/query hot paths (`packaging.md`, `golden-queries.md`, plans — referenced only where architecture points).                                                                                                                          |
| `.agents/`                                        | Governance/skills skimmed where they intersect docs (`improve-codebase-architecture/SKILL.md`); remaining rules/skills do not alter runtime perf facts.                                                                                                                      |

### 1.3 Code verified for hot paths

`src/worker-pool.ts`, `src/parse-worker-core.ts`, `src/application/index-engine.ts` (`indexFiles`, `insertParsedResults`, `queryRows`), `src/application/bindings-engine.ts` (`resolveBindings`), `src/application/query-engine.ts` (`executeQuery`), `src/sqlite-db.ts`, `src/db.ts` (`openDb`/`closeDb`, `batchInsert`, `createIndexes` refs), `src/api.ts`, `src/glob-sync.ts`.

### 1.4 “Official docs” fact-check discipline

SQLite PRAGMA semantics (e.g. `journal_mode=WAL`, `synchronous`, `foreign_keys`) are summarized in-repo in `docs/architecture.md`; authoritative reference: [SQLite PRAGMA documentation](https://www.sqlite.org/pragma.html).  
Runtime split Bun vs Node: `docs/architecture.md` + `sqlite-db.ts` (not exhaustively cross-checked against Bun’s current site — implementation is the ground truth).

---

## 2. Architecture snapshot (fact-checked against code)

1. **Layering:** CLI lazy-loads command chunks (`docs/architecture.md` § Layering); engines under `application/` stay transport-agnostic.
2. **Full rebuild:** `dropAll` → `createTables` → `PRAGMA synchronous=OFF` / `foreign_keys=OFF` (`index-engine.ts`), **parallel parse** via `parseFilesParallel`, **sorted** `results.sort(…localeCompare)`, bulk `insertParsedResults`, then **`createIndexes`**, restore PRAGMAs, then **`resolveBindings` + cycles + re-export chains** (full only) — matches `docs/architecture.md` § Full Rebuild Optimizations and code comment referencing R.10/R.12.
3. **Incremental / targeted:** Sequential per-file loop inside one transaction; **no worker pool** (`indexFiles` branch `fullRebuild === false`).
4. **Workers:** `WORKER_COUNT = max(2, min(cpus, 6))` (`worker-pool.ts` line 23). Chunks divide `filePaths.length / WORKER_COUNT`. Bun: `Worker` per chunk, **terminate after one message**. Node: `worker_threads`, terminate on message.
5. **`line_count`:** Both `parse-worker-core.ts` and incremental path in `index-engine.ts` use an O(bytes) newline scan (`charCode === 10`). Same semantics both paths — any micro-optimization must preserve parity.
6. **Query path:** `executeQuery` opens DB, runs `PRAGMA query_only=1`, executes SQL, closes (`query-engine.ts`). `Codemap.query` → `queryRows` opens/closes **without** `query_only` (`api.ts`, `index-engine.ts`) — behavioural/security nuance noted below.
7. **Write path closes:** Non-readonly `closeDb` runs `analysis_limit` + `optimize` (`db.ts`), matching `architecture.md` § On close (`readonly` skips for concurrent readers).

---

## 3. Existing strengths (already shipped)

Aligned with `docs/architecture.md` and `docs/benchmark.md`; verified against code:

- **Deferred index creation** on full rebuild + single `createIndexes` pass.
- **`batchInsert`**: `BATCH_SIZE = 500`, precomputed placeholders, index-based iteration (`db.ts`).
- **SQLite:** WAL + `mmap_size`, negative `cache_size` (16 MiB page cache), `temp_store=MEMORY`.
- **Partial / covering indexes** for common agent-query shapes (`architecture.md` tables).
- **Instrumentation:** `--performance` → `IndexPerformanceReport`; `benchmark.ts` compares indexed SQL vs glob+read+regex.
- **Operational:** default watcher on MCP/HTTP reduces redundant incremental preludes (`architecture.md` Watch wiring).

---

## 4. Improvement opportunities (no intended behaviour change)

Each item lists **risk** to identical outputs / contracts and **how to validate**.

### 4.1 P1 — Measurement & falsifiable claims _(process / roadmap alignment)_

- **Observation:** `docs/roadmap.md` § Backlog calls for **“Falsifiable benchmark CI”** on named corpora; `docs/benchmark.md` warns run-to-run variance on small trees.
- **Plan:** Implement that backlog item: pin fixtures, automate `bun src/benchmark.ts` (+ optional `--performance` on index runs), store ranges or medians — **does not change product behaviour**.
- **Validation:** Same SQL row counts (`test:golden`); comparable or stricter wall-time budgets optional.

### 4.2 P1 — Eliminate duplicated work on incremental hot path _(micro, safe if equivalent)_

- **Observation:** Incremental indexing recomputes `line_count` with a full-buffer scan **after** `readFileSync` already materialized `source` (`index-engine.ts`). Full-rebuild workers do the same (`parse-worker-core.ts`).
- **Plan:** Optionally delegate line counting to a shared helper (e.g. **`countUtf8Lines(source: string)`**), consider `for..of` / `split` tradeoffs **only behind benchmark proof** — must match current semantics (UTF-16 indices vs byte indices are not affected; both count `\n` code units).
- **Risk:** Low if golden + hash/compare `files.line_count` on `fixtures/minimal`.
- **Validation:** Golden tests + spot-check large files.

### 4.3 P2 — Main-thread bottleneck after parallelism _(parse vs insert)_

- **Observation:** `architecture.md`: workers return structured results; **main thread** runs `resolveImports` during `insertParsedResults` and SQLite inserts. Large monorepos: parse wall time may dominate, but resolver + inserts can overlap poorly with wasted CPU.
- **Plan (non-breaking):**
  - **Profile-guided:** use `--performance` + OS-level profiler to confirm `insert_ms` vs `parse_ms` on a large `--root`.
  - **Pipeline (hypothesis):** stream worker results in chunks (still **sorted before insert batch** — order must preserve current B-tree locality guarantee from `architecture.md` § Sorted inserts). Any async chunking must **not** reorder rows relative to today's `localeCompare(relPath)` total order.
- **Risk:** Medium — ordering / transaction boundaries must preserve crash-recovery semantics and identical row sets.
- **Validation:** Diff `.codemap/index.db` with `sqlite3 .dump` or row-count/hash per table after index on identical inputs.

### 4.4 P2 — Bindings resolver memory & CPU scaling _(full rebuild tail)_

- **Observation:** `resolveBindings` issues **seven** `SELECT … .all()` queries (`symbols`, `scopes`, `import_specifiers`, `imports`, `exports`, `files`, `references`) then resolves in JS (`bindings-engine.ts`). Correctness contract is invariant; asymptotic cost grows with corpus.
- **Plan (orthogonal to behaviour):**
  - **SQLite-side:** stays read-only aggregation; pushing resolution into SQL would change semantics subtly — **not** recommended without formal spec parity.
  - **JS-side:** reduce allocations (reuse arrays, TypedArrays for hot maps) — must preserve deterministic output order (`insertBindings` order).
  - Optional **streaming** references in chunks → still emit identical multiset of binding rows unless current code relies on global ordering (verify `persistBindings`).
- **Risk:** Medium; needs binding golden tests beyond minimal fixture if expanded.
- **Validation:** Equality of `bindings` row set before/after; run `fixtures/minimal` + larger synthetic corpus.

### 4.5 P3 — Worker pool ergonomics _(optional config, same defaults)_

- **Observation:** Hard cap **`min( cpus, 6 )`** ignores user preference / CI vCPU limits.
- **Plan:** Env e.g. `CODEMAP_PARSE_WORKERS` (cap + floor documented) — **default stays today’s formula** → no behaviour change unless set.
- **Risk:** Low; only perf characteristics change when opted in.

### 4.6 P3 — Persistent read-only connection for multi-query servers _(architecture trade)_

- **Observation:** `architecture.md`: HTTP docs say **open / query_only / close per request**. `executeQuery` always `openDb()`. Same pattern reduces contention but repeats connection setup & PRAGMAs.
- **Plan:** Behind a scoped internal pool or “long-lived read connection” **only where transport owns lifecycle** (`mcp-server`/`http-server`), still honour WAL reader semantics; writes (index/watch) remain separate handles.
- **Risk:** Higher — WAL checkpoint visibility, shutdown ordering, Bun vs Node divergence; requires careful stress tests **without** weakening `PRAGMA query_only` safety on write handles.
- **Validation:** Concurrent read tests + ensure no DDL/DML escapes read path.

### 4.7 P3 — Align `queryRows` with read-only pragma _(parity + defence in depth)_

- **Observation:** Programmatic **`Codemap.query`** uses `queryRows` which **does not** set `PRAGMA query_only=1` unlike `executeQuery`.
- **Plan:** Add `query_only` to `queryRows`/`printQueryResult` SQLite path unless a test proves it breaks unsupported pragmas embedded in user SQL (**unlikely for read helpers** — still verify).
- **Risk:** Breaking change if callers relied on undocumented mutating behaviour through `Codemap.query` — treat as correctness hardening when confirmed.

### 4.8 P4 — Idle memory: Node `better-sqlite3` prepared-statement cache

- **Observation:** `sqlite-db.ts` uses `stmtCache = new Map` with **no eviction** → long-running processes issuing **many unique SQL strings** grow memory unbounded (_hypothesis_: rare for typical recipe sets).
- **Plan:** LRU cap on cache size for Node path — no functional change except eviction of LRU prepared statements.
- **Risk:** Low; micro-benchmark LRU overhead.

---

## 5. Constraints from project doctrine (avoid “perf” regressions)

- **Moat B** (`docs/roadmap.md`): Do **not** drop schema columns/tables for theoretical speed without proving columns are unread and without recipe impact — perf work should prefer **measuring**, **SQLite tuning**, **hot-path algorithmics**, optional **configs**.
- **`docs/architecture.md` § Schema versioning:** Avoid unnecessary `SCHEMA_VERSION` bumps; rebuild cost is explicit.
- **`docs/glossary.md` / `architecture.md`:** FTS5 stays **optional** (`--with-fts` / config) — flipping default would be a **product** change, not a silent perf patch.

---

## 6. Suggested sequencing (tracer-bullet friendly)

1. **Benchmark harness / CI parity** (`roadmap` item) → establishes guardrails.
2. **Safety / parity:** merge `query_only` alignment with tests.
3. **Low-risk incremental:** shared `line_count`, optional worker env cap (defaults unchanged).
4. **Higher risk:** main-thread streaming insert only with DB identity proofs; read-connection pooling behind transport flag.

---

## 7. Appendix — `.agents/` + `docs/` file manifest (enumeration)

**.agents/** (27):  
`skills/write-a-skill/SKILL.md`, `skills/docs-governance/SKILL.md`, `skills/improve-codebase-architecture/LANGUAGE.md`, `rules/codemap.md`, `skills/diagnose/scripts/hitl-loop.template.sh`, `rules/docs-governance.md`, `rules/agents-tier-system.md`, `rules/tracer-bullets.md`, `skills/improve-codebase-architecture/INTERFACE-DESIGN.md`, `skills/improve-codebase-architecture/SKILL.md`, `skills/improve-codebase-architecture/DEEPENING.md`, `rules/plan-pr-inspiration-discipline.md`, `skills/audit-pr-architecture/SKILL.md`, `rules/agents-first-convention.md`, `skills/codemap/SKILL.md`, `rules/verify-after-each-step.md`, `rules/concise-reporting.md`, `rules/concise-comments.md`, `lessons.md`, `rules/preserve-comments.md`, `skills/docs-lifecycle-sweep/SKILL.md`, `skills/diagnose/SKILL.md`, `skills/grill-me/SKILL.md`, `rules/no-bypass-hooks.md`, `rules/lessons.md`, `rules/pr-comment-fact-check.md`, `skills/pr-comment-fact-check/SKILL.md`.

**docs/** (18):  
`benchmark.md`, `glossary.md`, `research/non-goals-reassessment-2026-05.md`, `README.md`, `packaging.md`, `roadmap.md`, `plans/.gitkeep`, `plans/c9-plugin-layer.md`, `plans/github-marketplace-action.md`, `plans/lsp-diagnostic-push.md`, `plans/substrate-extraction.md`, `audits/.gitkeep`, `architecture.md`, `research/.gitkeep`, `research/codemap-richer-index-synthesis-2026-05.md`, `agents.md`, `golden-queries.md`, `why-codemap.md`.

---

_End of audit._
