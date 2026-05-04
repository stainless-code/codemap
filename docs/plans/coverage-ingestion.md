# Static coverage ingestion (`coverage-final.json` → `coverage` table)

> **Status:** in design (no code) · **Backlog:** [research/fallow.md § C.11](../research/fallow.md#tier-c--ship-eventually-months-high-payoff-large-surface). Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Ingest Istanbul-format coverage JSON (`coverage-final.json`) into the codemap index so structural queries can compose coverage filters in pure SQL — without bolting Codemap to a runtime tracer or paid coverage stack.

The killer recipe this unlocks:

```sql
-- "What's structurally dead AND untested?" — single query, two evidence axes.
SELECT s.name, s.file_path, c.coverage_pct
FROM symbols s
LEFT JOIN coverage c ON c.symbol_id = s.id
WHERE s.is_exported = 1
  AND s.id NOT IN (SELECT callee_id FROM calls WHERE callee_id IS NOT NULL)
  AND COALESCE(c.coverage_pct, 0) = 0
ORDER BY s.file_path, s.line_start;
```

Today an agent has to run two tools (`codemap` + a coverage reader) and join in JS. After this lands it's one `query` + one `JOIN`.

## Why

- **Codemap is structural-only today.** Every "is this dead?" query has a structural false-positive rate (the §0 fallow audit found an 8-file widget pack with non-zero structural fan-in but zero runtime usage). Coverage is the **complementary evidence axis** — `structural fan-in = 0` AND `runtime coverage = 0` is the high-confidence "dead" predicate.
- **Static ingestion is free.** Istanbul-format JSON is the universal output format for `c8`, `nyc`, `vitest --coverage`, `jest --coverage`, `bun test --coverage`. We're not building a coverage tracer — we're reading the artifact those tools already produce.
- **Fallow's runtime intelligence is paid.** Static coverage ingestion gets ~80% of the agent value (the "is X dead?" predicate above) without entering Fallow's V8/production-beacon territory (explicit non-goal per [research/fallow.md § D.16](../research/fallow.md#defer--skip)).
- **Composes with `codemap impact`.** `impact <symbol> --direction up --depth 0` returns callers; joining `coverage` on the result tells the agent "this symbol has 12 callers but only 2 of them are hit by tests" — refactor risk in one query.

## Sketched layout

### Schema (D1, D2)

```sql
-- New table; symbols-side denormalisation rejected (see D1).
CREATE TABLE coverage (
  symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  coverage_pct REAL NOT NULL,         -- 0.0 – 100.0; statement coverage (see D5)
  hit_lines INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  source TEXT NOT NULL,               -- ingester id, e.g. "istanbul" / "lcov" (D3)
  PRIMARY KEY (symbol_id)
) STRICT, WITHOUT ROWID;

-- File-level rollup so "rank files by coverage" doesn't have to GROUP BY symbols.
CREATE TABLE file_coverage (
  file_path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  coverage_pct REAL NOT NULL,
  hit_lines INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (file_path)
) STRICT, WITHOUT ROWID;

-- Meta row: timestamp + source path of the last successful ingest. Lets agents
-- check freshness without a separate verb. NULL when no coverage ever ingested.
INSERT INTO meta (key, value) VALUES ('coverage_last_ingested_at', '<unix-ms>');
INSERT INTO meta (key, value) VALUES ('coverage_last_ingested_path', '<abs-path>');
INSERT INTO meta (key, value) VALUES ('coverage_last_ingested_source', 'istanbul');
```

`ON DELETE CASCADE` on `symbols(id)` and `files(path)` means re-indexing automatically drops the coverage rows whose symbols/files no longer exist. **Stale-coverage handling falls out for free** (D6).

### CLI

```text
codemap ingest-coverage <path> [--source istanbul|lcov] [--prune] [--json]
```

- `<path>` — required. Path to `coverage-final.json` (Istanbul, default), `lcov.info` (LCOV, v1.x), or directory containing `coverage-final.json`.
- `--source` — optional. Auto-detected from filename / extension; flag overrides.
- `--prune` — also `DELETE FROM coverage` rows whose `symbol_id` no longer matches a symbol that has 1+ statement in the ingested coverage map (handles "symbol still exists but nothing covers it"). Default off; `coverage_pct = 0` rows are valid evidence.
- `--json` — emit `{ingested: {symbols: N, files: M}, skipped: {unmatched_files: K}, source: "istanbul"}` envelope on stdout.

Decoupled from `codemap` (the index command) on purpose (D4) — coverage runs once per `bun test --coverage` invocation, not once per file edit.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Separate `coverage` table, not columns on `symbols`.** Resolves the open question in [research/fallow.md § 6](../research/fallow.md#6-open-questions). Three reasons: (a) coverage shape evolves independently of structural columns (per-branch, per-function, per-line metrics layered later) — denormalising churns `SCHEMA_VERSION` every time; (b) `symbols` rows exist for every TS / TSX file; coverage rows only for tested files — joining via `LEFT JOIN coverage` keeps NULL semantics explicit; (c) `coverage` survives a `--full` reindex because it lives next to `query_baselines` (intentional `dropAll()` exclusion — see [`db.ts` `query_baselines` comment](../../src/db.ts) for precedent). |
| D2  | **Two tables — symbol-level + file-level rollup.** File-level rollup is a single-table scan instead of `GROUP BY symbols.file_path` over a JOIN. The denormalisation cost is one extra UPSERT per file at ingest time; the read-side win is every "files ranked by coverage" query becomes a primary-key scan on `file_coverage`. Mirrors `dependencies` (composite PK) vs `imports` (raw rows) split.                                                                                                                                                                                                                                                                                                            |
| D3  | **Istanbul JSON in v1; LCOV in v1.x; c8 raw V8 traces never.** Istanbul JSON (`coverage-final.json`) is the universal IR — `c8`, `nyc`, `vitest`, `jest`, `bun test --coverage` all emit it. LCOV (`lcov.info`) is the second-most-common format; ingester is ~50 LoC of regex parsing — defer to v1.x once Istanbul lands. Raw V8 traces (`*.cpu.profile` / `coverage-c8/*.json`) are out of scope — they're Fallow's paid moat and require a runtime tracer Codemap doesn't ship.                                                                                                                                                                                                                               |
| D4  | **One-shot `codemap ingest-coverage <path>`, NOT auto-detected during `codemap` runs.** Reasons: (a) `codemap` is sub-100ms cold-start; auto-probing for `coverage/coverage-final.json` adds a `stat` and grows the surface for "where did codemap look for coverage?"; (b) coverage cadence (once per test run) is decoupled from index cadence (every file edit) — coupling them means stale coverage on every save; (c) explicit verb makes the agent's mental model trivial: "tests ran → `codemap ingest-coverage` → `codemap query`". `codemap watch` does NOT auto-ingest coverage on `coverage-final.json` change (separate concern; revisit if demand materialises).                                     |
| D5  | **Statement coverage only in v1.** Istanbul tracks statement / branch / function / line coverage separately. `coverage_pct` is **statement** coverage (the most stable signal across runners — function coverage misses anonymous closures, branch coverage explodes for switch / ternary). v1.x can add `branch_coverage_pct` / `function_coverage_pct` columns once a real consumer asks. Don't pre-emptively widen.                                                                                                                                                                                                                                                                                            |
| D6  | **Coverage rows survive `--full` reindex.** `coverage` and `file_coverage` join the `query_baselines` precedent — intentionally absent from `dropAll()` so a `--full` rebuild doesn't nuke the user's last ingest. `ON DELETE CASCADE` on `symbols(id)` / `files(path)` handles the "symbol no longer exists" case automatically when those rows reinsert. Re-running `codemap ingest-coverage` is the user's explicit "refresh" verb.                                                                                                                                                                                                                                                                            |
| D7  | **Symbol mapping by `(file_path, line_start ≤ stmt_line ≤ line_end)`.** Istanbul's `statementMap` is line-keyed; we project per-statement hits onto the enclosing symbol via the same line-range projection `markers` already uses. Symbols whose range covers ≥1 statement get a `coverage` row; symbols whose range covers 0 statements (interface declarations, type aliases) don't — they appear as `NULL` in `LEFT JOIN coverage`. No fuzzy matching, no source-map walking — plain BETWEEN.                                                                                                                                                                                                                 |
| D8  | **Path normalisation: project-relative, forward-slashed.** Istanbul writes absolute paths; we strip `<projectRoot>/` and replace `\\` with `/` to match `files.path`. Files outside the project root land in `skipped.unmatched_files`. Same projection `toProjectRelative()` (in `validate-engine`) already does — reuse the helper instead of rewriting it.                                                                                                                                                                                                                                                                                                                                                     |
| D9  | **MCP / HTTP exposure: column in `query` results, NOT a separate `coverage` tool.** The killer recipe (top of this doc) is one SQL query — `query` / `query_recipe` already returns `coverage_pct` as a column when the SELECT asks for it. A standalone `coverage` MCP tool would duplicate the surface; revisit only if a consumer ships a wrapper script that proves the SQL ergonomic gap is real.                                                                                                                                                                                                                                                                                                            |
| D10 | **`codemap audit` integration deferred.** Adding `--delta coverage` to `audit` is the natural next step (flag "files where `coverage_pct` dropped >5% vs `--base`") but layered on top of D1–D9. Track as v1.x backlog; ship the ingester + raw schema first.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D11 | **Ingester lives in `application/coverage-engine.ts`.** Same engine-vs-CLI split as `impact` / `audit`: pure ingester (`ingestCoverage({db, source, payload}) → IngestResult`) consumed by `cli/cmd-ingest-coverage.ts`. No MCP / HTTP transport in v1 (D9). Engine is unit-testable against fixture Istanbul JSON without spinning up the CLI.                                                                                                                                                                                                                                                                                                                                                                   |
| D12 | **Schema bump = minor changeset.** Adds two tables (`coverage`, `file_coverage`) + three meta keys; doesn't break any existing query. Per [`.agents/lessons.md`](../../.agents/lessons.md) "changesets bump policy", new tables = minor; the `SCHEMA_VERSION` bump auto-rebuilds the index on next `codemap` run. Coverage rows are then absent until the user runs `ingest-coverage` again — documented in the changeset.                                                                                                                                                                                                                                                                                        |

## Tracer-bullet plan

Per [`tracer-bullets.mdc`](../../.cursor/rules/tracer-bullets.mdc) — vertical slices, each shippable on its own.

| #   | Tracer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Acceptance                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **Schema + bump** in `src/db.ts`. Add `coverage` + `file_coverage` table DDL; bump `SCHEMA_VERSION`; add both tables to the `query_baselines`-style "preserve across `--full`" exclusion in `dropAll()`. New `meta` keys (`coverage_last_ingested_at` / `_path` / `_source`) need no DDL — `meta` is `(key, value)` already. Unit test (`src/db.test.ts`) inserts + reads back one row of each shape; verifies CASCADE on `DELETE FROM symbols`.                                                                                                                                                                                                                                          | Tables exist; CASCADE works; `--full` reindex preserves coverage rows.                                         |
| 2   | **Istanbul ingester engine** in `src/application/coverage-engine.ts` (new). `ingestCoverage({db, payload, source: "istanbul", projectRoot}) → {ingested, skipped, source}`. Pure: parses the Istanbul JSON shape (`{ [absPath]: {statementMap, s, fnMap, f, branchMap, b, path} }`), maps statement coverage (`s` counter) to symbols via the line-range projection (D7), upserts `coverage` and `file_coverage`, writes meta keys. Reuses `toProjectRelative` from `validate-engine` (D8). Unit tests cover: fresh ingest, re-ingest (UPSERT idempotence), unmatched file (skipped), symbol with 0 statements (NULL row), absolute → relative path normalisation, Windows-path handling. | Pure engine; deterministic upsert; no FS / process side effects beyond `db.run`.                               |
| 3   | **CLI verb** `cli/cmd-ingest-coverage.ts` — parses `<path>` + `--source` + `--prune` + `--json`, reads the file (`Bun.file` on Bun, `readFile` on Node — same split as `config.ts`), dispatches to `coverage-engine`, renders the result. `main.ts` dispatcher gains the verb between existing entries. Help text in `bootstrap.ts` lists the new command. Unit tests cover: file-not-found, malformed JSON, source mismatch (`--source lcov` on a `coverage-final.json`), `--json` envelope shape.                                                                                                                                                                                       | `bun src/index.ts ingest-coverage fixtures/coverage/coverage-final.json` writes rows; `--help` lists the verb. |
| 4   | **Fixture coverage data** — `fixtures/minimal/coverage/coverage-final.json` (small Istanbul shape covering the existing fixture symbols partially: e.g. `usePermissions` 100%, `legacyClient` 0%, `now` 50%). Golden query under `fixtures/golden/minimal/coverage-deprecated.json` exercises the killer recipe ("`@deprecated` symbols with `coverage_pct = 0`"). Adds the fixture row to `fixtures/minimal/README.md` "What's exercised" table. The pre-enriched `legacyClient` / `now` / `epochMs` deprecated symbols (PR #55) directly test the join axis — no new fixture symbols needed beyond the coverage JSON itself.                                                            | Golden recipe passes; documents how a real consumer wires `bun test --coverage` into the workflow.             |
| 5   | **Doc + agent rule + skill + changeset + plan deletion** — `docs/architecture.md` § Persistence wiring (new tables, ingester engine, CLI verb), `docs/glossary.md` (`coverage_pct`, `file_coverage`, "Istanbul JSON", "static coverage ingestion"), `.agents/rules/codemap.md` + `templates/agents/rules/codemap.md` (Rule 10 lockstep — new trigger pattern: "What's untested AND structurally dead?", new SQL example), skill SKILL.md `coverage` table row, README.md "What's exercised" + Use section. Minor changeset noting the `SCHEMA_VERSION` bump + the explicit re-ingest needed after upgrade. Plan deleted per `docs/README.md` Rule 3.                                      | All docs consistent; agents see the new tables on next `codemap agents init`.                                  |

## Performance considerations

- **Ingest cost** — one `JSON.parse` + linear scan of statement maps. A 1000-file Istanbul payload is ~100 KB; parse + ingest in <50 ms (read benchmark: `query_baselines` `INSERT` of comparable shape benches at ~1 µs / row).
- **Read cost** — `coverage` is `WITHOUT ROWID` keyed on `symbol_id`; every join is a primary-key lookup. `LEFT JOIN coverage ON c.symbol_id = s.id` adds <1 ms to recipe queries even on 10k-symbol corpora.
- **Storage** — two `INTEGER` + one `REAL` + one short `TEXT` per symbol; sub-50 bytes / row. 10k symbols = ~500 KB on disk. Negligible vs the index size (~MBs).
- **No background worker.** Ingest is single-pass; reindex is unaffected.

## Alternatives considered

| Candidate                                                                        | Why not                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Add `coverage_pct REAL` + `is_runtime_hot INTEGER` to `symbols` directly**     | Per D1: shape-coupling, NULL ambiguity, schema-bump amplification. The original sketch ([research/fallow.md § C.11](../research/fallow.md#tier-c--ship-eventually-months-high-payoff-large-surface)) listed this — D1 supersedes.                                                                            |
| **Auto-detect `coverage/coverage-final.json` during `codemap` runs**             | Per D4: cadence mismatch + auto-probe surface. The auto-detect path is also harder to reason about ("why does this index include coverage on machine A but not B?"); explicit verb is unambiguous.                                                                                                           |
| **Ship LCOV ingester in v1 alongside Istanbul**                                  | Doubles the test surface for marginal value — every modern coverage tool emits Istanbul JSON natively; LCOV is the legacy path. Defer to v1.x; add `--source lcov` once a consumer asks.                                                                                                                     |
| **Embed runtime coverage tracer (V8 / Istanbul beacons)**                        | Out of scope per [research/fallow.md § D.16](../research/fallow.md#defer--skip) and [roadmap.md § Non-goals](../roadmap.md#non-goals-v1). This plan reads artifacts; it does not produce them.                                                                                                               |
| **`coverage` rows keyed by `(file_path, line_start)` instead of `symbol_id`**    | Decouples coverage from symbol identity — robust to symbol renames between ingest and reindex. Rejected because the killer recipe is "join coverage to symbols," and a composite key forces every join to repeat `(file_path, line_start)` instead of `symbol_id`. CASCADE on `symbols(id)` handles renames. |
| **Separate MCP `coverage` tool returning `{symbol, pct, hit, total}` envelopes** | Per D9: the column-in-`query`-results path is composable with every existing recipe + ad-hoc SQL; a standalone tool would force a parallel surface for one column. Revisit if SQL composition proves too verbose for agents.                                                                                 |
| **Inline coverage into `codemap audit` v1 (`--delta coverage`)**                 | Per D10: the plan stays small. Audit-side delta is a clean follow-up once the raw schema lands.                                                                                                                                                                                                              |
| **Persist coverage in a sibling JSON file (`<state-dir>/coverage.json`)**        | Forces every consumer to re-implement the join; loses SQL composability. The whole point of Codemap is "it's a SQL index" — keep coverage in the same DB.                                                                                                                                                    |

## Out of scope

- **Branch / function / line coverage breakdowns** — D5; v1.x once a consumer asks with a concrete query.
- **Coverage diff against baseline** — `--save-baseline` / `--baseline` already covers arbitrary query result snapshots; coverage queries inherit it for free. A first-class `coverage_diff` would duplicate.
- **Coverage trend over time** — adjacent to telemetry; not in v1. Consumers can `--save-baseline coverage-snapshot-2026-05-04` periodically.
- **CI verdict / threshold logic** — same condition as `codemap audit verdict`: defer until a consumer ships a `jq` script that proves the threshold shape.
- **Auto-running tests** — Codemap reads coverage artifacts; it doesn't invoke `bun test --coverage`. Test orchestration is the user's CI.
- **Source-map-aware coverage** — Istanbul's `statementMap` is post-transform; coverage rows reflect the compiled file's structure. Source-map walking to original `.ts` lines is deferred (most projects with TS test runners already emit Istanbul against the pre-compile source via `vitest` / `bun test` instrumentation).
