# Agent enrichment wave — tracer workflow (plans 3–4)

> **Status:** in-flight · **Scope:** remaining P2 plans ranked by consumer/agent ROI
>
> **Goal:** Ship tracer bullets that cut agent round-trips, improve answer trust, and sharpen PR/CI deltas — all Moat-A (predicate columns, no verdict primitives).
>
> **Shipped (plans retired):** Evidence chains ([#174](https://github.com/stainless-code/codemap/pull/174)) · Graph-estimated CRAP ([#175](https://github.com/stainless-code/codemap/pull/175)) — durable contract in `golden-queries.md` + `architecture.md`; plan files deleted per [docs-governance](../../.agents/skills/docs-governance/SKILL.md) § Closing a plan.
>
> **Remaining:** [coverage-deletion-confidence](./coverage-deletion-confidence.md) → [audit-delta-attribution](./audit-delta-attribution.md)

---

## Shared conventions (locked)

| Convention                                                                                                                                                                                            | Applies to |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Moat A** — no `pass`/`fail` engine verdict; extra columns only                                                                                                                                      | All        |
| **`reason` TEXT** — machine code + short clause where useful                                                                                                                                          | #3         |
| **`evidence_json` TEXT** — bounded JSON array (≤3 hops)                                                                                                                                               | shipped #1 |
| **`confidence` / `coverage_source` / `attribution`** — recipe-specific enums                                                                                                                          | #3, #4     |
| **Golden update per slice** — `fixtures/golden/minimal/*.json` + `scenarios.json`                                                                                                                     | All        |
| **`/harden-pr lite`** after each tracer commit; **`/harden-pr full`** before PR merge                                                                                                                 | All        |
| **Retire plan on merge** — delete `docs/plans/<topic>.md` + lift to reference docs/roadmap in the **same PR** (never leave shipped plans as leftovers)                                                | All        |
| **No deferring complements** — agent surfaces (rule/skill/MCP), glossary, golden/script tests, and plan acceptance items ship **in the same PR** unless explicitly listed under plan **Out of scope** | All        |

**Cross-plan synergy:** shipped evidence `reason` complements #4 `attribution` on audit `added` rows. CRAP `coverage_source` (#175) ships before #3 so deletion-confidence can narrow rows with coverage semantics.

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

| PR                         | Contents        | Changeset | Retire plan on merge              |
| -------------------------- | --------------- | --------- | --------------------------------- |
| **#D Deletion confidence** | Plan 3 complete | patch     | `coverage-deletion-confidence.md` |
| **#E Audit attribution**   | Plan 4 complete | patch     | `audit-delta-attribution.md`      |

Each PR: `harden-pr full` (includes plan retirement) → merge. Do not batch plans 3–4 into one PR.

---

## Current slice

**Active:** Plan 3 slice **3.1** on `feat/high-crap-score` or fresh branch from `main` after **#175** merges — `coverage-confirmed-dead` recipe fork.
