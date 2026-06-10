# Graph-estimated CRAP score — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~2 weeks)
>
> **Motivator:** CRAP ranks **complex and undertested** functions. Codemap has `symbols.complexity` + ingested `coverage`, but `high-complexity-untested` is **misleading without ingest** (`COALESCE(coverage_pct, 0)` treats missing as 0%). Graph-estimated tiers (85/40/0%) from test reachability when measured coverage is absent.
>
> **Roadmap:** [§ Recipe & audit enrichment](../roadmap.md#recipe--audit-enrichment)

---

## Agent start here

Spike the **reachability CTE** on `fixtures/minimal` (or codemap self-index) before authoring recipe files. Reuse **`test_suites`** + `affected-tests` glob conventions for test-file seeds. Recipe-only v1 — no schema migration.

### Key touchpoints

| File                                                                                                     | What to read                                                     |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`templates/recipes/high-complexity-untested.sql`](../../templates/recipes/high-complexity-untested.sql) | Coverage `COALESCE` pattern to replace/extend                    |
| [`templates/recipes/affected-tests.sql`](../../templates/recipes/affected-tests.sql)                     | Test file / `test_suites` detection                              |
| [`templates/recipes/`](../../templates/recipes/)                                                         | Frontmatter + param conventions                                  |
| [`src/db.ts`](../../src/db.ts)                                                                           | `coverage`, `dependencies`, `calls`, `references`, `symbols` DDL |
| [`docs/golden-queries.md`](../golden-queries.md)                                                         | Golden scenario registration                                     |

### Architecture

```text
recipe high-crap-score (SQL only)
  → test_files CTE (test_suites + globs)
  → reachable_files (deps from test_files)
  → per symbol: measured coverage OR tier 85/40/0
  → CRAP formula → rows + coverage_source column
```

### Spike results (slice 2.0, `fixtures/minimal`)

`scripts/spike-crap-reachability.sql` + `scripts/spike-crap-reachability.test.mjs` lock tier counts on function-shaped symbols:

| Tier | Count | Example                                                                  |
| ---- | ----- | ------------------------------------------------------------------------ |
| 85%  | 1     | `labyrinth` — direct `bindings` ref from `smoke.test.ts`                 |
| 40%  | 4     | `deeplyNested`, `relay`, … — `complexity-fixture.ts` reachable from test |
| 0%   | 39    | `createClient`, `get`, … — not dependency-reachable from tests           |

Reachability walk: `test_suites` + `*.test.*` / `*.spec.*` globs → recursive `dependencies` fan-out (value edges only).

### Tracer bullet (slice 2.1)

Recipe SQL + `.md` on fixture index without coverage ingest (tiers only). Golden row asserting `coverage_source: estimated`. `scripts/high-crap-score-measured.test.mjs` asserts `ingest-coverage` → `measured` overrides.

### Out of scope (v1)

`symbols.estimated_coverage_pct` materialised column; new CLI verb; treating estimates as CI gate (document as heuristic only).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                                                                                      | Source                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| G.1 | **Recipe-first v1** — bundled `high-crap-score` (or `crap-score`) as SQL over existing tables; no new verdict CLI verb.                                                                                                                                                                                       | [Moat A](../roadmap.md#moats-load-bearing)             |
| G.2 | **CRAP formula** — `crap_score = CC² × (1 - effective_coverage/100)³ + CC` where `CC = symbols.complexity`; threshold param default 30 (industry convention).                                                                                                                                                 | Published CRAP definition                              |
| G.3 | **Coverage precedence** — per symbol: use ingested `coverage.coverage_pct` when a row exists; else use graph-estimated tier. Column `coverage_source: measured \| estimated`.                                                                                                                                 | Composes with `ingest-coverage`                        |
| G.4 | **Estimation tiers (v1)** — when no measured coverage row: **85%** if symbol is directly referenced from a test file (`calls` / `references` from `test_suites.file_path`); **40%** if source `file_path` is dependency-reachable from any test file but symbol is not directly referenced; **0%** otherwise. | Static graph heuristic — document false-positive class |
| G.5 | **Test file detection** — seed set = `test_suites.file_path` UNION paths matching default test suffix globs (`*.test.*`, `*.spec.*`, same as `affected-tests`).                                                                                                                                               | Shipped `test_suites` + recipe precedent               |
| G.6 | **Heuristic disclaimer** — recipe `.md` states estimates ≠ execution; prefer `ingest-coverage` for CI gates.                                                                                                                                                                                                  | Agent-facing honesty                                   |

---

## SQL shape (sketch)

```sql
-- illustrative; final recipe may use CTEs for test_files, reachable_files, symbol_refs
WITH test_files AS ( … ),
     reachable_files AS ( … recursive deps from test_files … ),
     effective AS (
       SELECT s.*,
         COALESCE(c.coverage_pct,
           CASE
             WHEN direct_test_ref THEN 85
             WHEN file_reachable THEN 40
             ELSE 0
           END) AS effective_coverage_pct,
         CASE WHEN c.coverage_pct IS NOT NULL THEN 'measured' ELSE 'estimated' END AS coverage_source
       FROM symbols s
       LEFT JOIN coverage c ON …
       …
     )
SELECT name, file_path, complexity, effective_coverage_pct, coverage_source,
       (complexity * complexity * POWER(1 - effective_coverage_pct / 100.0, 3) + complexity) AS crap_score
FROM effective
WHERE complexity IS NOT NULL AND crap_score >= :min_crap
ORDER BY crap_score DESC;
```

---

## Implementation steps

1. Spike reachability CTE on `fixtures/minimal` + codemap self-index — validate tier counts vs intuition.
2. Author `templates/recipes/high-crap-score.sql` + `.md` (params: `min_crap`, optional `limit`).
3. Golden scenario with + without `ingest-coverage` on same fixture (measured overrides estimated).
4. Cross-link from `high-complexity-untested.md` as alternative when coverage not ingested.
5. Optional v2 (defer): materialise `symbols.estimated_coverage_pct` at index time if recipe CTE is too slow on 10k+ trees — trigger-gated per perf plan discipline.

---

### Verification

```bash
bun src/index.ts query --recipe high-crap-score --json --root fixtures/minimal
bun src/index.ts ingest-coverage <fixture-coverage> && bun src/index.ts query --recipe high-crap-score --json
bun test scripts/query-golden-coverage-matrix.test.mjs   # after golden scenario added
```

---

## Acceptance

- [x] Without coverage ingest: symbols in files imported by tests get tier 40/85; isolated files get 0%
- [x] With coverage ingest: `coverage_source = measured` and CRAP uses real `coverage_pct`
- [x] `codemap query --recipe high-crap-score --json` works; SARIF compatible via `--format sarif`
- [x] No new pass/fail primitive

---

## Open decisions (impl PR)

| #   | Question                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ |
| Q1  | Include type-only imports in reachability walk? (default: value edges only, mirror import graph) |
| Q2  | Recipe id: `high-crap-score` vs `crap-score`?                                                    |
| Q3  | Materialised column at index time vs recipe-only — measure CTE cost on self-index first.         |

---

## Dependencies

- Shipped: `symbols.complexity`, `coverage`, `dependencies`, `calls`, `references`, `test_suites`, `affected-tests` glob conventions
- Synergy: [`symbols.cognitive_complexity`](../glossary.md#symbolscognitive_complexity--cognitive-complexity) (optional second axis in same recipe later); [coverage-deletion-confidence](./coverage-deletion-confidence.md) (opposite signal — dead + zero coverage)
- Weaker until: [c9-plugin-layer](./c9-plugin-layer.md) (framework test files may be misclassified)
