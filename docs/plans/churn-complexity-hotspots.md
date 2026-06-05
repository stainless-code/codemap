# Churn × complexity hotspots — plan

> **Status:** open · **Priority:** P2 · **Effort:** L–M (~2–3 weeks)
>
> **Motivator:** Agents and maintainers prioritize refactors by **change frequency × structural complexity** — files that churn often _and_ carry heavy symbols are higher-risk touch points than either signal alone. Today `symbols.complexity` exists but git churn is not indexed; `codemap hotspots` alias maps to import **fan-in**, not change×complexity.
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)

---

## Agent start here

Ship **schema + mocked churn rows + recipe SQL** before wiring real `git log` ingest — proves the JOIN path without git subprocess flakiness in CI. Read `symbols.complexity` and outcome aliases in [`src/cli/aliases.ts`](../../src/cli/aliases.ts); do **not** repoint `hotspots` alias (stays `fan-in`).

### Key touchpoints

| File                                                                       | What to read                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`src/db.ts`](../../src/db.ts)                                             | `SCHEMA_VERSION`, table DDL, migrations                       |
| [`src/application/index-engine.ts`](../../src/application/index-engine.ts) | Full / incremental index hooks (where churn refresh attaches) |
| [`src/extractors/complexity.ts`](../../src/extractors/complexity.ts)       | Existing `symbols.complexity` population                      |
| [`templates/recipes/`](../../templates/recipes/)                           | Recipe `.sql` + `.md` pair pattern (e.g. `fan-in`)            |
| [`src/cli/aliases.ts`](../../src/cli/aliases.ts)                           | Outcome alias `hotspots` → `fan-in` — leave unchanged         |
| [`src/cli/cmd-query.ts`](../../src/cli/cmd-query.ts)                       | Recipe catalog registration path                              |

### Architecture

```text
index (full or incremental)
  → churn-ingest: git log --numstat scoped to indexed files.path
  → file_churn rows (weighted_commits, trend, …)
recipe churn-complexity-hotspots
  → SQL JOIN file_churn × symbols.complexity → hotspot_score
  → query / MCP / HTTP (Moat A — no new verb)
```

### Tracer bullet (slice 1)

1. `file_churn` table + migration. 2. Insert fixture churn rows in test. 3. `churn-complexity-hotspots.sql` returns ranked paths. 4. Wire real git ingest in slice 2.

### Out of scope (v1)

Repurposing `codemap hotspots` CLI alias; symbol-level hotspot rows (file-level only unless Q1 resolves otherwise); non-git VCS import (`--churn-file`).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                        | Source                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| H.1 | **Moat-B substrate** — new `file_churn` table populated at index time (or lazy first-query with cache in `meta`).                                                               | [Moat B](../roadmap.md#moats-load-bearing)               |
| H.2 | **Moat-A exposure** — bundled recipe `churn-complexity-hotspots` (distinct from outcome alias `hotspots` → `fan-in`).                                                           | [Moat A](../roadmap.md#moats-load-bearing); `aliases.ts` |
| H.3 | **Git-native churn v1** — `git log --numstat` (or `git log --format` + diff stat) scoped to indexed `files.path` set; optional `--churn-since <ref>` CLI flag on ingest.        | No network; matches incremental git invalidation story   |
| H.4 | **Recency weighting** — store `weighted_commits` with exponential half-life (default 90 days) so recent edits rank above ancient history.                                       | Tunable via config `churn.halfLifeDays`                  |
| H.5 | **Score is a recipe column, not a verdict** — `hotspot_score` computed in SQL JOIN (`file_churn` × aggregated `symbols.complexity` / `file_metrics`); consumer applies `LIMIT`. | Moat A                                                   |
| H.6 | **Optional trend column** — `churn_trend: "accelerating" \| "stable" \| "cooling"` from recent-vs-older window ratio; nullable when insufficient history.                       | v1 nice-to-have; ship score first if schedule tight      |

---

## Schema sketch

```sql
CREATE TABLE file_churn (
  file_path TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL,
  weighted_commits REAL NOT NULL,
  lines_added INTEGER NOT NULL,
  lines_removed INTEGER NOT NULL,
  last_commit_at TEXT,
  churn_trend TEXT,
  computed_at TEXT NOT NULL
) STRICT;
```

Recipe joins `file_churn` to per-file max/avg `symbols.complexity` (and optionally `file_metrics.line_count`):

```sql
-- sketch only; final SQL lives in templates/recipes/churn-complexity-hotspots.sql
SELECT f.path,
       fc.weighted_commits,
       MAX(s.complexity) AS max_complexity,
       (fc.weighted_commits * MAX(s.complexity)) AS hotspot_score
FROM files f
JOIN file_churn fc ON fc.file_path = f.path
JOIN symbols s ON s.file_path = f.path
WHERE s.complexity IS NOT NULL
GROUP BY f.path
ORDER BY hotspot_score DESC;
```

Normalize score to 0–100 in recipe if cross-repo comparability matters (divide by corpus max).

---

## Implementation steps

1. **Churn ingest module** — `src/application/churn-ingest.ts`: spawn bounded git subprocess; map paths to indexed files only; respect `.gitignore` / codemap excludes.
2. **Index hook** — run churn refresh on full rebuild; incremental path refreshes churn for changed files + ancestors if needed (v1: full churn recompute acceptable on incremental if <2s on medium repos — measure in plan PR).
3. **`file_churn` table** + `SCHEMA_VERSION` bump + migration in `db.ts`.
4. **Recipe** — `churn-complexity-hotspots` with params `limit`, optional `min_complexity`.
5. **CLI** — no new outcome alias (fan-in keeps `hotspots`); document recipe in catalog + `context` intent keywords ("refactor priority", "hotspot", "churn").
6. **Golden fixture** — synthetic git history in test repo or mocked churn rows.
7. Docs — `architecture.md` schema row; `glossary.md` disambiguate `hotspots` alias vs `churn-complexity-hotspots` recipe.

---

### Verification

```bash
bun test src/application/churn-ingest.test.ts   # after module lands
bun src/index.ts query --recipe churn-complexity-hotspots --json
bun src/index.ts query --recipe fan-in --json    # alias hotspots unchanged
bun run typecheck                                # db.ts schema + SymbolRow if touched
```

---

## Acceptance

- [ ] Recipe returns files ranked by churn×complexity on codemap self-index
- [ ] Outcome alias `codemap hotspots` still resolves to `fan-in`
- [ ] Churn ingest skips non-git repos gracefully (empty `file_churn`, recipe returns empty set + stderr hint)
- [ ] No new pass/fail CLI verb

---

## Open decisions (resolve in plan PR)

| #   | Question                                                                                     |
| --- | -------------------------------------------------------------------------------------------- |
| Q1  | File-level vs symbol-level hotspot rows — v1 file-level only?                                |
| Q2  | Recompute churn on every incremental index vs explicit `codemap index --refresh-churn` flag? |
| Q3  | Import `--churn-file` JSON for non-git VCS — defer unless consumer asks?                     |

---

## Dependencies

- Existing: `symbols.complexity`, `files`, `file_metrics`, git helpers in incremental index
- Independent of [C.9 plugin layer](./c9-plugin-layer.md)
