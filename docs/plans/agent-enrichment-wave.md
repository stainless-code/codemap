# Agent enrichment wave — tracer workflow (complete)

> **Status:** complete · **Scope:** P2 agent-enrichment plans (#2–#4)
>
> **Goal:** Ship tracer bullets that cut agent round-trips, improve answer trust, and sharpen PR/CI deltas — all Moat-A (predicate columns, no verdict primitives).
>
> **Shipped (plans retired):** Evidence chains ([#174](https://github.com/stainless-code/codemap/pull/174)) · Graph-estimated CRAP ([#175](https://github.com/stainless-code/codemap/pull/175)) · Coverage deletion confidence ([#176](https://github.com/stainless-code/codemap/pull/176)) · Audit delta attribution (PR **#E**) — durable contracts in `golden-queries.md` + `architecture.md` + `glossary.md`; plan files deleted per [docs-governance](../../.agents/skills/docs-governance/SKILL.md) § Closing a plan.

---

## Shared conventions (locked)

| Convention                                                                                                                                                                                            | Applies to |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **Moat A** — no `pass`/`fail` engine verdict; extra columns only                                                                                                                                      | All        |
| **`reason` TEXT** — machine code + short clause where useful                                                                                                                                          | shipped    |
| **`evidence_json` TEXT** — bounded JSON array (≤3 hops)                                                                                                                                               | shipped    |
| **`confidence` / `coverage_source` / `attribution`** — recipe-specific enums                                                                                                                          | shipped    |
| **Golden update per slice** — `fixtures/golden/minimal/*.json` + `scenarios.json`                                                                                                                     | All        |
| **`/harden-pr lite`** after each tracer commit; **`/harden-pr full`** before PR merge                                                                                                                 | All        |
| **Retire plan on merge** — delete `docs/plans/<topic>.md` + lift to reference docs/roadmap in the **same PR** (never leave shipped plans as leftovers)                                                | All        |
| **No deferring complements** — agent surfaces (rule/skill/MCP), glossary, golden/script tests, and plan acceptance items ship in the **same PR** unless explicitly listed under plan **Out of scope** | All        |

**Cross-plan synergy:** evidence `reason` complements `attribution` on audit `added` rows. `confidence` narrows deletion triage after `ingest-coverage`.
