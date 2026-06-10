# Agent enrichment wave — tracer workflow (plan 4)

> **Status:** in-flight · **Scope:** remaining P2 plan ranked by consumer/agent ROI
>
> **Goal:** Ship tracer bullets that cut agent round-trips, improve answer trust, and sharpen PR/CI deltas — all Moat-A (predicate columns, no verdict primitives).
>
> **Shipped (plans retired):** Evidence chains ([#174](https://github.com/stainless-code/codemap/pull/174)) · Graph-estimated CRAP ([#175](https://github.com/stainless-code/codemap/pull/175)) · Coverage deletion confidence (PR **#D**) — durable contracts in `golden-queries.md` + `architecture.md`; plan files deleted per [docs-governance](../../.agents/skills/docs-governance/SKILL.md) § Closing a plan.
>
> **Remaining:** [audit-delta-attribution](./audit-delta-attribution.md)

---

## Shared conventions (locked)

| Convention                                                                                                                                                                                            | Applies to     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Moat A** — no `pass`/`fail` engine verdict; extra columns only                                                                                                                                      | All            |
| **`reason` TEXT** — machine code + short clause where useful                                                                                                                                          | shipped        |
| **`evidence_json` TEXT** — bounded JSON array (≤3 hops)                                                                                                                                               | shipped        |
| **`confidence` / `coverage_source` / `attribution`** — recipe-specific enums                                                                                                                          | shipped #3, #4 |
| **Golden update per slice** — `fixtures/golden/minimal/*.json` + `scenarios.json`                                                                                                                     | All            |
| **`/harden-pr lite`** after each tracer commit; **`/harden-pr full`** before PR merge                                                                                                                 | All            |
| **Retire plan on merge** — delete `docs/plans/<topic>.md` + lift to reference docs/roadmap in the **same PR** (never leave shipped plans as leftovers)                                                | All            |
| **No deferring complements** — agent surfaces (rule/skill/MCP), glossary, golden/script tests, and plan acceptance items ship in the **same PR** unless explicitly listed under plan **Out of scope** | All            |

**Cross-plan synergy:** shipped evidence `reason` complements #4 `attribution` on audit `added` rows. Shipped `confidence` (#D) narrows deletion triage after `ingest-coverage`.

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

| PR                       | Contents        | Changeset | Retire plan on merge         |
| ------------------------ | --------------- | --------- | ---------------------------- |
| **#E Audit attribution** | Plan 4 complete | patch     | `audit-delta-attribution.md` |

Each PR: `harden-pr full` (includes plan retirement) → merge.

---

## Current slice

**Active:** Plan 4 slice **4.1** on fresh branch from `main` after **#D** merges — `findingKey()` helper + unit tests.
