# Evidence chains on recipe rows — plan

> **Status:** open · **Priority:** P2 · **Effort:** M–L (~2–4 weeks, phased per recipe)
>
> **Motivator:** High-judgment recipes (`unimported-exports`, `boundary-violations`, `deprecated-symbols`, …) return locatable rows but agents still re-query (`barrel-chains`, `fan-in`, `find-symbol-references`) to learn **why** a row appeared before `apply` or manual edits. Enriching rows with compact `reason` + optional `evidence` fields cuts round-trips and reduces false-positive deletions.
>
> **Roadmap:** [§ Recipe & audit enrichment](../roadmap.md#recipe--audit-enrichment)

---

## Agent start here

Start with **`boundary-violations`** (rule metadata already in row — add `reason` + thin `evidence_json`). Then `deprecated-symbols`, then `unimported-exports` (needs `re_export_chains`). Update golden queries per wave.

### Key touchpoints

| File                                                                                           | What to read                                  |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [`templates/recipes/boundary-violations.sql`](../../templates/recipes/boundary-violations.sql) | Simplest JOIN to extend                       |
| [`templates/recipes/unimported-exports.sql`](../../templates/recipes/unimported-exports.sql)   | Re-export false-positive class                |
| [`templates/recipes/deprecated-symbols.sql`](../../templates/recipes/deprecated-symbols.sql)   | Caller subquery target                        |
| [`src/db.ts`](../../src/db.ts)                                                                 | `re_export_chains`, `boundary_rules`, `calls` |
| [`docs/golden-queries.md`](../golden-queries.md)                                               | Assert new columns in JSON rows               |
| [`docs/architecture.md`](../architecture.md) § Recipes wiring                                  | Recipe `.sql` + `.md` pair contract           |

### Architecture

```text
recipe SQL SELECT …, reason, evidence_json
  → query-engine (unchanged transport)
  → JSON rows (extra columns; SARIF/annotations ignore unless mapped later)
```

Evidence is **in-SQL**, not a post-processor — same Moat-A path as the recipe.

### Tracer bullet (slice 1)

`boundary-violations`: add `reason` constant + `evidence_json` with rule tuple; one golden query. Ship before touching `unimported-exports` re-export subquery. **Orchestration:** [agent-enrichment-wave.md](./agent-enrichment-wave.md) § Plan 1 slice 1.1 — **shipped in working tree** (await commit).

### Out of scope (v1)

`untested-and-dead` / `visibility-tags` evidence (v2); audit `added` row attribution merge (optional v2 with [audit-delta-attribution](./audit-delta-attribution.md)); post-query enrichment engine (Q2).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                          | Source                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| E.1 | **SQL columns, not a post-processor** — evidence lives in the recipe `SELECT` (JOINs / scalar subqueries). Same Moat-A path as the recipe itself; no hidden engine verdict.       | [Moat A](../roadmap.md#moats-load-bearing) |
| E.2 | **Standard column names** — `reason TEXT` (short machine-readable code + human clause) and optional `evidence_json TEXT` (JSON array of hop objects) on allowlisted recipes only. | Recipe contract extension                  |
| E.3 | **Bounded evidence** — cap chain depth (e.g. 3 hops) and JSON length in SQL (`LIMIT` in subqueries); truncate with `{truncated: true}` in JSON.                                   | Token budget / agent ergonomics            |
| E.4 | **Complements `actions[]`** — frontmatter `actions` stay the UX hint; `reason`/`evidence_json` are factual substrate the agent can cite.                                          | Shipped recipe frontmatter pattern         |
| E.5 | **Phased rollout** — v1: `unimported-exports`, `boundary-violations`, `deprecated-symbols`; v2: `untested-and-dead`, `visibility-tags` as patterns prove out.                     | Tracer bullets                             |
| E.6 | **Not a confidence verdict** — `reason` explains detection path; optional `confidence_hint: low\|medium` only where recipes already document false-positive classes.              | No pass/fail primitive                     |

---

## Per-recipe evidence (v1)

| Recipe                | `reason` examples                                                               | `evidence_json` shape (sketch)                                                                                  |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `unimported-exports`  | `no_direct_import` · `reexport_chain_possible` · `unresolved_import_blind_spot` | `[{kind:"reexport",from_file,to_file,hops}]` from `re_export_chains` when export name appears in a chain        |
| `boundary-violations` | `boundary_deny_match`                                                           | `[{rule_name,from_glob,to_glob}]` (rule metadata already in row — evidence duplicates for stable JSON contract) |
| `deprecated-symbols`  | `deprecated_jsdoc` · `has_callers` · `no_callers`                               | `[{kind:"caller",name,file_path,line_start}]` top-N from `calls` / `references`                                 |

---

## Implementation steps

**Wave 1 — contract**

1. Document evidence column convention in `docs/golden-queries.md` (and one line in `docs/architecture.md` § Recipes if warranted).
2. Add golden-query scenarios asserting `reason` present on v1 recipes.

**Wave 2 — `boundary-violations`** (simplest — rule join already explicit) 3. Add `reason`, `evidence_json` columns to SQL + update `.md` frontmatter description.

**Wave 3 — `unimported-exports`** 4. LEFT JOIN / subquery against `re_export_chains` for same export `name`; set `reason` when chain exists. 5. Subquery count of `imports` with `resolved_path IS NULL` targeting same module as `unresolved_import_blind_spot` hint (optional v1.1).

**Wave 4 — `deprecated-symbols`** 6. Attach top 3 caller rows via correlated subquery or CTE; `reason` reflects caller count bucket.

**Wave 5 — agent surfaces** 7. One line in `templates/agent-content/skill/` — "high-judgment recipe rows may include `reason` / `evidence_json`; parse before `apply`." 8. MCP `query_recipe` tool description note (no new tool).

---

### Verification

```bash
bun src/index.ts query --recipe boundary-violations --json      # wave 2
bun src/index.ts query --recipe unimported-exports --json       # wave 3
bun src/index.ts query --recipe deprecated-symbols --json       # wave 4
bun test scripts/query-golden-coverage-matrix.test.mjs          # golden rows assert reason / evidence_json
```

Ship one recipe per wave; verify before moving to the next.

---

## Acceptance

- [ ] `codemap query --recipe unimported-exports --json` rows include `reason`; re-export false-positive class includes non-empty `evidence_json` when chain exists
- [ ] `boundary-violations` rows include stable `reason: boundary_deny_match`
- [ ] `deprecated-symbols` rows with callers include `evidence_json` caller hops
- [ ] Golden queries updated; no new CLI verb
- [ ] SARIF / annotations unchanged (extra columns ignored by formatters unless future mapping added)

---

## Open decisions (impl PR)

| #   | Question                                                                                          | Lock (wave 2026-06)                                               |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Q1  | Single `evidence_json` vs separate typed columns (`reexport_hops`, `caller_count`)?               | **`evidence_json` only** (E.2) — one JSON contract per recipe row |
| Q2  | Post-query enrichment in `query-engine` for recipes that opt in via frontmatter `evidence: true`? | **SQL-only** (E.1) — no post-processor in v1                      |
| Q3  | Include `binding_kind` from `bindings` for rename-preview synergy in v1 or v2?                    | **v2**                                                            |

---

## Dependencies

- Shipped: `re_export_chains`, `dependencies`, `boundary_rules`, `calls`, `references`, `bindings`, recipe `actions` frontmatter
- Synergy: [audit-delta-attribution](./audit-delta-attribution.md) (attribution + reason on audit `added` rows — optional merge in v2)
- Weaker until: [c9-plugin-layer](./c9-plugin-layer.md) (reachability reasons for `untested-and-dead` evidence in v2)
