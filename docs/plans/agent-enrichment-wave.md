# Agent enrichment wave — tracer workflow (plans 1–4)

> **Status:** in-flight · **Scope:** four P2 plans ranked by consumer/agent ROI
>
> **Goal:** Ship tracer bullets that cut agent round-trips, improve answer trust, and sharpen PR/CI deltas — all Moat-A (predicate columns, no verdict primitives).
>
> **Plans (execution order):** [evidence-chains](./evidence-chains-on-recipe-rows.md) → [graph-estimated-crap](./graph-estimated-crap.md) → [coverage-deletion-confidence](./coverage-deletion-confidence.md) → [audit-delta-attribution](./audit-delta-attribution.md)

---

## Shared conventions (locked)

| Convention                                                                            | Applies to |
| ------------------------------------------------------------------------------------- | ---------- |
| **Moat A** — no `pass`/`fail` engine verdict; extra columns only                      | All four   |
| **`reason` TEXT** — machine code + short clause where useful                          | #1, #3     |
| **`evidence_json` TEXT** — bounded JSON array (≤3 hops)                               | #1         |
| **`confidence` / `coverage_source` / `attribution`** — recipe-specific enums          | #2, #3, #4 |
| **Golden update per slice** — `fixtures/golden/minimal/*.json` + `scenarios.json`     | All        |
| **`/harden-pr lite`** after each tracer commit; **`/harden-pr full`** before PR merge | All        |

**Cross-plan synergy:** #1 `reason` on recipes complements #4 `attribution` on audit `added` rows (optional merge in evidence plan v2). #2 and #3 both touch coverage semantics — ship #2 before #3 so agents have CRAP tiers before deletion-confidence narrows rows.

---

## Plan 1 — Evidence chains (`evidence-chains-on-recipe-rows.md`)

| Slice                         | Deliverable                                                        | Verify                |
| ----------------------------- | ------------------------------------------------------------------ | --------------------- |
| **1.0 contract**              | `docs/golden-queries.md` § evidence columns; one architecture line | doc review            |
| **1.1 `boundary-violations`** | `reason` + `evidence_json` in SQL; `.md` + golden                  | `bun run test:golden` |
| **1.2 `deprecated-symbols`**  | caller hops in `evidence_json`                                     | golden + matrix       |
| **1.3 `unimported-exports`**  | `re_export_chains` LEFT JOIN; `reason` variants                    | golden                |
| **1.4 agent surface**         | `templates/agent-content/rule/00-full.md` one-liner                | consumer check        |

**Open decisions (locked for v1):** E.2 `evidence_json` only (not typed columns); E.1 SQL-only (no query-engine post-processor).

---

## Plan 2 — Graph-estimated CRAP (`graph-estimated-crap.md`)

| Slice                     | Deliverable                                                     | Verify            |
| ------------------------- | --------------------------------------------------------------- | ----------------- |
| **2.0 spike**             | Reachability CTE on `fixtures/minimal` (script or ad-hoc query) | manual row counts |
| **2.1 recipe**            | `high-crap-score.sql` + `.md`; `scenarios.json`                 | `test:golden`     |
| **2.2 measured override** | golden with `ingest-coverage` setup                             | golden matrix     |
| **2.3 cross-link**        | `high-complexity-untested.md` points at CRAP when no ingest     | doc               |

**Grill before 2.1 if spike ambiguous:** Q1 type-only imports in walk (default: value edges only); Q2 recipe id `high-crap-score`.

---

## Plan 3 — Coverage deletion confidence (`coverage-deletion-confidence.md`)

| Slice                      | Deliverable                                                    | Verify        |
| -------------------------- | -------------------------------------------------------------- | ------------- |
| **3.1 recipe fork**        | `coverage-confirmed-dead.sql` + `.md` from `untested-and-dead` | query CLI     |
| **3.2 golden no-ingest**   | `confidence: medium` policy (per D.4)                          | `test:golden` |
| **3.3 golden with ingest** | fixture coverage → `confidence: high`                          | `test:golden` |
| **3.4 classifier**         | intent keywords if needed                                      | optional      |

**Grill before 3.1:** Q3 without ingest — `medium` rows vs empty + stderr (plan D.4 leans medium rows).

---

## Plan 4 — Audit delta attribution (`audit-delta-attribution.md`)

| Slice                            | Deliverable                             | Verify                 |
| -------------------------------- | --------------------------------------- | ---------------------- |
| **4.1 `findingKey()`**           | pure helper + unit tests                | `audit-engine.test.ts` |
| **4.2 `deprecated` delta**       | `attribution` on `added[]` for `--base` | branch fixture test    |
| **4.3 `files` + `dependencies`** | generalize key sets from base cache     | tests                  |
| **4.4 transport parity**         | MCP/HTTP envelope match CLI             | handler test           |
| **4.5 docs**                     | `architecture.md` envelope §            | doc                    |

---

## PR cadence

| PR                         | Contents                             | Changeset |
| -------------------------- | ------------------------------------ | --------- |
| **#A Evidence wave 1**     | Slices 1.0–1.1 (boundary-violations) | patch     |
| **#B Evidence wave 2**     | Slices 1.2–1.4                       | patch     |
| **#C CRAP recipe**         | Plan 2 complete                      | patch     |
| **#D Deletion confidence** | Plan 3 complete                      | patch     |
| **#E Audit attribution**   | Plan 4 complete                      | patch     |

Each PR: `harden-pr full` → merge. Do not batch plans 1–4 into one PR.

---

## Current slice

**Active:** Plan 1 slice **1.3** — `unimported-exports` re-export evidence (next on `feat/evidence-chains-boundary`).
