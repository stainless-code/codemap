# (a) FTS5 + Mermaid output — plan

> **Status:** open · all design decisions resolved (iteration round 1, 2026-05); ready for Slice 1 impl. Plan iterates while the (b) C.9 plan PR runs in parallel (per [`docs/research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-recommended-next-pick-under-the-new-framing))
>
> **Slot:** track-1 shipping cadence T+0 → +1w. First moat-flipping ship after the research note merge.
>
> **Scope:** **two non-goal flips in one PR** because both are small (~50–150 LoC each) and demonstrate complementary moat alignment — § 2.1 (FTS5 = moat B substrate growth) + § 2.2 (Mermaid = moat A output mode).

---

## Pre-locked decisions (from non-goals-reassessment grill)

| #   | Decision                                                                                                                                                                                                                                                             | Source                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| L.1 | **FTS5 default OFF** — backwards-compat (existing `.codemap/index.db` shouldn't grow ~30–50% silently on next `--full`). Re-evaluate default in v2 once external-corpus size measurements land.                                                                      | [§ 6 Q2 resolved](../research/non-goals-reassessment-2026-05.md#6-open-questions)                                                 |
| L.2 | **Toggle: BOTH** `codemap.config.ts` `fts5: true` AND `--with-fts` CLI flag at index time. Config-only forces CI / ephemeral workflows to commit `fts5: true`; CLI-only forces every long-term user to remember the flag on `--full`.                                | [§ 6 Q2 resolved](../research/non-goals-reassessment-2026-05.md#6-open-questions)                                                 |
| L.3 | **Mermaid `--format` is an output mode, never a verdict** — moat A clean. Recipe rows in, mermaid text out.                                                                                                                                                          | [§ 3 Moat A](../research/non-goals-reassessment-2026-05.md#3-true-architectural-limits--preserve)                                 |
| L.4 | **Bounded-input contract for `--format mermaid`** — input must come from `impact` engine, a `LIMIT N`-shipped recipe, or ad-hoc SQL with explicit `LIMIT ≤ 50`. Unbounded inputs error with a scope-suggestion message. **No auto-truncation** (would be a verdict). | [§ 1.7](../research/non-goals-reassessment-2026-05.md#1-capability-inventory--already-shippable-today)                            |
| L.5 | **Bundle one demo recipe** (`text-in-deprecated-functions`) exemplifying the FTS5 ⨯ `symbols` ⨯ `coverage` JOIN composability that ripgrep can't do.                                                                                                                 | [§ 2.1](../research/non-goals-reassessment-2026-05.md#21--no-fts5--use-ripgrep-for-full-text)                                     |
| L.6 | **Cold-start sub-100ms preserved** — FTS5 is index-time cost only; one-shot CLI reads the existing DB and the virtual table doesn't slow startup.                                                                                                                    | [§ 3 ergonomic floor "Sub-100ms cold-start"](../research/non-goals-reassessment-2026-05.md#3-true-architectural-limits--preserve) |

---

## Open decisions

All seven Q's resolved in **iteration round 1 (2026-05)**. Recommendations baked from research-note pre-locked decisions, existing codebase patterns (`coverage` table substrate for FTS5 plumbing, `meta` table for toggle state, `--root` / `--state-dir` precedent for CLI / config precedence), and the [SQLite FTS5 docs](https://www.sqlite.org/fts5.html). User can override any decision before Slice 1 starts.

### Resolved (2026-05)

- ✅ **Q1 — `source_fts` virtual-table schema** — **`(file_path UNINDEXED, content)`** columns, **`tokenize = 'porter unicode61'`** tokeniser. Reasoning:
  - **`file_path UNINDEXED`** — never tokenise paths; filtering is exact via `WHERE file_path = ?`. UNINDEXED skips the tokeniser cost.
  - **`content`** — full file source (UTF-8 text, no normalisation beyond the tokeniser's). Stored verbatim so JOIN-with-other-tables matches line numbers from `markers` / `symbols`.
  - **`porter unicode61`** — Porter stemmer over Unicode-aware tokeniser. Catches `auth` / `authenticate` / `authentication` as related; `unicode61` handles non-ASCII identifiers cleanly. `trigram` was the alternative — better for partial-string matches but ~3× larger index. Per the [SQLite FTS5 docs § Tokenizers](https://www.sqlite.org/fts5.html#tokenizers), `porter unicode61` is the standard for code search where stemming-of-camelCase isn't a concern.
  - **No `last_modified` column** — FTS5 deletion + re-insertion at incremental reindex handles freshness; storing it separately would duplicate `files.last_modified` (Rule 1 violation).
  - **No `WITHOUT ROWID` equivalent** — FTS5 virtual tables don't support that pragma; the implicit rowid-keyed shape is fine.
- ✅ **Q2 — Indexer integration point** — **Same pass as `files` insert**, in the indexer's per-file write path. After the file content is loaded for parsing (already in memory), tee a copy to `source_fts` when `getCodemapConfig().fts5 === true`. Reasoning:
  - File content is already in memory at parse time — no extra disk I/O.
  - Same transaction as the `files` row insert → atomic; either both land or neither does.
  - `--files <paths>` incremental: each path's `source_fts` row is `DELETE` + `INSERT` (FTS5 supports both). `--full` rebuild: `DELETE FROM source_fts;` followed by per-file inserts.
- ✅ **Q3 — `--full` rebuild semantics on toggle change** — **Auto-detect via `meta` table; force `--full` on next reindex.** Reasoning:
  - Existing `meta` table accommodates the toggle state via key-value (`meta.fts5_enabled`). Indexer reads on startup; if it differs from the resolved config / CLI flag, log a clear stderr line and force `--full` (drop existing `source_fts` rows + repopulate).
  - "You must `--full` after toggling" was the simpler alternative but ships a UX trap — quiet user changes config, next `codemap` run silently produces stale FTS5 data, queries return wrong rows. Auto-detect + clear log is worth the small `meta`-table surface.
- ✅ **Q4 — Mermaid edge-count threshold value** — **Hard-coded 50 for v1**, named constant (`MERMAID_MAX_EDGES`) in `src/application/output-formatters.ts`. Reasoning:
  - § 1.7 of research note locked **50** as the default. Make-configurable (`mermaid_max_edges` config field) is YAGNI for v1; tune the constant in code if 50 proves wrong on real-world data.
  - Cheap to promote to a config field later (additive; backwards-compat).
- ✅ **Q5 — Mermaid output target shape** — **Normalised input contract: `{from, to, label?, kind?}`** rows. Recipes / ad-hoc SQL must alias their columns to match. The formatter renders `from -->|label| to` (with `kind` styling node shape if present). Reasoning:
  - `dependencies.from_path → to_path` aliases trivially: `SELECT from_path AS "from", to_path AS "to" FROM dependencies LIMIT 50`.
  - `calls.caller_name → callee_name` same pattern.
  - `impact` engine output already shapes `{from, to, edge, kind}` — minor rename `edge` → `label` in the formatter input adapter.
  - Optional `label` lets recipes add edge-text (`"calls"` vs `"imports"`); optional `kind` lets node shape vary (`"file"` vs `"function"`).
  - Recipes that don't shape correctly → formatter rejects with: `[mermaid] expected columns: from, to (with optional label, kind). Got: <actual columns>. Alias via 'SELECT col AS "from", col2 AS "to"'.`
- ✅ **Q6 — `--with-fts` CLI flag precedence** — **CLI overrides config.** Reasoning:
  - Matches existing `--root` / `--state-dir` precedent (CLI wins). Mirrored in `bootstrap.ts` argv parsing.
  - When `--with-fts` passed AND `fts5: false` in config, log a stderr line: `[fts5] CLI override: enabled despite config fts5=false`. Quiet-divergence is the trap; explicit log avoids it.
- ✅ **Q7 — DB size telemetry** — **Yes, log size delta when `source_fts` is first populated.** One stderr line at end of full-FTS5 reindex: `[fts5] source_fts populated: <N> files / <X> KB / +<Y>% over base index`. Reasoning:
  - Cheap (single SELECT on `source_fts` size + `files` size at end of indexing).
  - Helps users measure the tax post-flip — informs the v2 default-on decision per the research note § 6 Q2 ("re-evaluate default in v2 once external-corpus size measurements land").
  - Stderr (not a config-toggleable verbose flag) — informational, one-line, on the first FTS5 populate only (subsequent reindexes don't re-log unless `--verbose`).

---

## High-level architecture

**FTS5 side:**

1. Schema bump in `src/db.ts` (`SCHEMA_VERSION` const).
2. `CREATE VIRTUAL TABLE source_fts USING fts5(...)` always emitted (empty if disabled; near-zero space).
3. Config gains `fts5: boolean` (default `false`) in Zod schema (`src/config.ts`).
4. CLI gains `--with-fts` index-time flag (overrides config when passed).
5. Indexer reads file content + writes to `source_fts` when toggle is on.
6. `.codemap/.gitignore` reconciler unchanged (FTS5 lives inside `index.db`; already ignored).

**Mermaid side:**

1. New `formatMermaid(rows, opts)` function in `src/application/output-formatters.ts` (sibling of existing SARIF / annotations).
2. Bounded-input check at function entry — count rows; reject with scope-suggestion message if > 50.
3. Plumb `--format mermaid` through CLI / MCP / HTTP dispatchers (existing pattern from SARIF).
4. Test against `impact` engine output (depth-bounded → naturally fits the contract).

**Crosscut:**

1. Bundled recipe `text-in-deprecated-functions.sql` + `.md` demonstrating the FTS5 JOIN.
2. Schema-bump migration story — pre-v1 patch changeset; SCHEMA_VERSION tick forces reindex; users see the bump in `bun run dev` output.
3. Agent rule + skill lockstep update per [`docs/README.md` Rule 10](../README.md) — both `templates/agents/` AND `.agents/` docs gain `source_fts` + `--format mermaid` references.

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

1. **Slice 1: FTS5 substrate (no demo recipe yet).** Schema bump + `source_fts` CREATE + Zod config field + indexer write path + `--with-fts` flag. Verify via `codemap --with-fts --full` then `codemap query "SELECT file_path FROM source_fts WHERE source_fts MATCH 'TODO' LIMIT 5"`. **No bundled recipe yet** — proves the substrate end-to-end before recipe authoring.
2. **Slice 2: Demo FTS5 recipe.** Ship `text-in-deprecated-functions.sql` + `.md` per L.5. Golden-query test added.
3. **Slice 3: Mermaid formatter (basic; no bound check).** New `formatMermaid` function in `output-formatters.ts`. Plumb `--format mermaid` through CLI dispatcher. Test on `impact` engine output (already bounded — proves the formatter without enforcing the bound check yet).
4. **Slice 4: Bounded-input enforcement.** Add the count-and-reject check; scope-suggestion error message names recipe + count + knobs (`LIMIT` / `--via` / `WHERE from_path LIKE`). Test with a deliberately-unbounded ad-hoc SQL → expect rejection.
5. **Slice 5: Plumb Mermaid through MCP + HTTP.** Existing `tool-handlers.ts` dispatcher should propagate `--format mermaid` via the same plumbing as SARIF — verify via MCP `query` tool + HTTP `POST /tool/query`.
6. **Slice 6: Docs + agent rule lockstep update.** Per Rule 10 — update `templates/agents/rules/codemap.md` + `templates/agents/skills/codemap/SKILL.md` AND `.agents/rules/codemap.md` + `.agents/skills/codemap/SKILL.md`. New CLI flag + new recipe + new format mode are all agent-queryable surfaces.
7. **Slice 7: Patch changeset.** Per pre-v1 lesson, schema-bumping changes are minor; FTS5 is opt-in (default OFF) so behaviour-preserving for existing users — patch suffices. Mermaid is purely additive — patch.

---

## Test approach

- **Unit:**
  - `db.ts` — assert `source_fts` table exists after init; round-trip a `MATCH` query.
  - `config.ts` — Zod accepts `fts5: true|false`; default OFF.
  - `cmd-index.ts` (or wherever `--with-fts` lands) — flag overrides config.
  - `output-formatters.ts` — `formatMermaid` happy path + bounded-input rejection path.
- **Golden queries** — add `text-in-deprecated-functions` to `fixtures/golden/scenarios.json` per [`docs/golden-queries.md`](../golden-queries.md). Mermaid output gated by recipe — covered by golden snapshot if applicable.
- **Integration fixture** — small TS fixture under `fixtures/golden/fts5-fixture/` with one `@deprecated` function containing a `TODO` comment in a low-coverage file, validating the JOIN composes.

---

## Risks / non-goals

| Item                                                               | Mitigation                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk:** index size growth surprises users who flip `fts5: true`. | Per L.1 default OFF; document size tax in `architecture.md § Schema`; consider Q7 telemetry warning.                                                                |
| **Risk:** indexer perf regression even when FTS5 is disabled.      | Always-CREATE the empty virtual table is near-zero cost; benchmarks (`bun run benchmark:query`) establish baseline pre-flip; verify post-impl.                      |
| **Risk:** Mermaid bounded-input rejection becomes an annoyance.    | Per L.4 the error message names knobs; "scope it via `LIMIT`" is the well-trodden SQL fix. Document the threshold tuning path (Q4) if hard-coded becomes a problem. |
| **Non-goal:** auto-truncation in Mermaid (would be a verdict).     | Per L.4 — explicitly out of scope.                                                                                                                                  |
| **Non-goal:** D2 / Graphviz formatters in this PR.                 | Mermaid first because MCP clients render it natively in chat. D2 / Graphviz follow if demand emerges.                                                               |
| **Risk:** plan abandoned mid-iteration.                            | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. Design surface captured.                                          |

---

## Cross-references

- [`docs/research/non-goals-reassessment-2026-05.md`](../research/non-goals-reassessment-2026-05.md) — research foundation (moats, ship sequence, pre-locked decisions L.1–L.6)
- [`docs/architecture.md`](../architecture.md) — schema reference (where `source_fts` virtual table lands)
- [`docs/golden-queries.md`](../golden-queries.md) — golden-query test pattern
- [`docs/packaging.md`](../packaging.md) — pre-v1 changeset policy (patch default unless schema-breaking)
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location)
- [`docs/README.md` Rule 10](../README.md) — agent rule lockstep update (Slice 6)
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence
- [`.agents/rules/verify-after-each-step.md`](../../.agents/rules/verify-after-each-step.md) — per-slice check discipline
