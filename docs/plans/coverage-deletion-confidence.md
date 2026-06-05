# Coverage × static deletion-confidence recipe — plan

> **Status:** open · **Priority:** P2 · **Effort:** L–M (~2–3 weeks)
>
> **Motivator:** `untested-and-dead` surfaces statically uncalled exports with zero coverage — strong candidates but still "verify before delete." When **both** static dead-code signals **and** ingested coverage show zero (or below-threshold) execution, agents need a tighter predicate row set for cleanup triage — without a `pass`/`fail` verdict primitive.
>
> **Roadmap:** [§ Recipe & audit enrichment](../roadmap.md#recipe--audit-enrichment)

---

## Agent start here

**Fork `untested-and-dead.sql`** — same static dead predicate + coverage JOIN — then add `confidence` column logic. No schema change in v1. Read [`templates/recipes/untested-and-dead.md`](../../templates/recipes/untested-and-dead.md) for C.9 caveat text to reuse.

### Key touchpoints

| File                                                                                       | What to read                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [`templates/recipes/untested-and-dead.sql`](../../templates/recipes/untested-and-dead.sql) | Core dead + coverage predicate             |
| [`templates/recipes/untested-and-dead.md`](../../templates/recipes/untested-and-dead.md)   | Framework false-positive disclaimer        |
| [`src/db.ts`](../../src/db.ts)                                                             | `coverage`, `calls`, `suppressions` tables |
| [`docs/golden-queries.md`](../golden-queries.md)                                           | Golden with + without coverage ingest      |
| [`src/cli/cmd-ingest-coverage.ts`](../../src/cli/cmd-ingest-coverage.ts) or ingest path    | Prerequisite for `high` confidence rows    |

### Architecture

```text
recipe coverage-confirmed-dead (SQL fork)
  → static dead core (untested-and-dead)
  → JOIN coverage: pct = 0 or absent
  → confidence: high (ingested zero) | medium (no ingest)
  → reason column (Moat A — not engine verdict)
```

### Tracer bullet (slice 1)

New `.sql` + `.md` + golden fixture with minimal Istanbul/LCOV ingest → one `high` row. Second scenario without ingest → `medium` only (or documented empty policy per D.4).

### Out of scope (v1)

`max_coverage_pct` param (v2); inverse "live + zero coverage" recipe; schema migration.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                  | Source                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| D.1 | **Recipe-only** — bundled id `coverage-confirmed-dead` (name TBD in impl PR); expressible as `query --recipe`; no standalone `codemap check-dead` verb.                                                                   | [Moat A](../roadmap.md#moats-load-bearing)          |
| D.2 | **Cross-product rows** — JOIN static dead predicate (same core as `untested-and-dead`: no incoming `calls`, export visibility, suppressions honored) WITH `coverage` where `coverage_pct = 0` OR row absent treated as 0. | Existing `untested-and-dead.sql` + `coverage` table |
| D.3 | **Explicit `confidence` column** — string enum on each row: `high` (static dead + zero coverage ingested), `medium` (static dead, no coverage ingest — same as untested-and-dead today), not a top-level verdict.         | Moat A — predicate columns, not engine verdict      |
| D.4 | **Requires ingest** — recipe frontmatter documents `codemap ingest-coverage` prerequisite; empty `coverage` table → only `medium` rows (or stderr hint when all rows medium).                                             | [ingest-coverage](../architecture.md)               |
| D.5 | **Complements C.9** — framework false-positives remain until `files.is_entry` ships; recipe description cites C.9 caveat (same as `untested-and-dead.md`).                                                                | [c9-plugin-layer](./c9-plugin-layer.md)             |
| D.6 | **Inverse recipe deferred** — "statically live + zero coverage" (risky untested hot path) is a separate recipe (`high-complexity-untested` partial overlap); out of scope for v1.                                         | Tracer bullet                                       |

---

## Row shape (sketch)

| Column                                    | Meaning                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `name`, `file_path`, `line_start`, `kind` | Symbol identity                                 |
| `coverage_pct`                            | From `coverage` JOIN (0 or NULL→0)              |
| `caller_count`                            | Fan-in from `calls` (0 for dead)                |
| `confidence`                              | `high` \| `medium`                              |
| `reason`                                  | Short text: e.g. `no_callers_and_zero_coverage` |

Optional v2: param `max_coverage_pct` (default 0) for "cold but not literally zero."

---

## Implementation steps

1. Author `templates/recipes/coverage-confirmed-dead.sql` + `.md` (suppressions, C.9 caveat, ingest prerequisite).
2. Golden query scenario in `fixtures/golden/` with minimal coverage fixture.
3. Register in recipe catalog; intent keywords in `context --for` classifier ("delete dead code", "coverage confirmed").
4. SARIF / annotations compatible via existing `--format` (location columns present).
5. No schema change required if v1 is pure SQL over existing tables.

---

### Verification

```bash
bun src/index.ts query --recipe coverage-confirmed-dead --json   # without ingest → medium
bun src/index.ts ingest-coverage <fixture> && bun src/index.ts query --recipe coverage-confirmed-dead --json
bun test scripts/query-golden-coverage-matrix.test.mjs
```

Compare row counts with `untested-and-dead` on same index — subset should be narrower when coverage ingested.

---

## Acceptance

- [ ] With coverage ingest: uncalled export at 0% → `confidence: high`
- [ ] Without coverage ingest: same symbol → `confidence: medium` (or documented empty result policy)
- [ ] Suppressions for `untested-and-dead` honored (shared recipe-id or explicit join — decide in impl PR)
- [ ] Expressible as `codemap query --recipe coverage-confirmed-dead --json`

---

## Open decisions (impl PR)

| #   | Question                                                                                    |
| --- | ------------------------------------------------------------------------------------------- |
| Q1  | Recipe id: `coverage-confirmed-dead` vs `deletion-confidence`?                              |
| Q2  | Share suppressions recipe-id with `untested-and-dead` or explicit duplicate in frontmatter? |
| Q3  | Without coverage ingest: emit `medium` rows or empty set + stderr hint?                     |

---

## Dependencies

- Shipped: `coverage` table, `ingest-coverage`, `untested-and-dead`, `calls`, `suppressions`
- Optional synergy: [audit-delta-attribution](./audit-delta-attribution.md) for PR-scoped runs with `--changed-since`
