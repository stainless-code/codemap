---
name: docs-lifecycle-sweep
description: Operationalises the docs-governance lifecycle on demand — produces a per-file Tier-A (keep verbatim) / Tier-B (slim + keep) / Tier-C (delete + lift) classification with evidence and an executable plan, then carries out the user's chosen actions. Use when the user says "clean up stale docs", "doc sweep", "audit docs lifecycle", "compact audits", "are these audits / plans still earning their keep", "delete tombstones", "doc janitor", "what's gone stale in docs/", "promote / lift / retire <doc>", or asks to enforce the existence test against any `docs/**` or `.agents/**` surface. NEVER deletes a file without surfacing the classification + evidence + cross-reference impact for user approval first.
---

# Docs lifecycle sweep — the doc janitor

[`docs-governance`](../docs-governance/SKILL.md) defines **what** every doc should be. This skill is the **how** — it walks any doc-bearing surface, applies the spec mechanically, and produces a per-file action plan the user approves before anything is touched.

The promise: at the end of a sweep, every remaining file passes the existence test, every closed plan is lifted, every closed audit is either kept-with-justification or deleted-with-knowledge-lifted, every cross-reference still resolves, and there is **no dead weight**.

**Procedure:** [WORKFLOW.md](./WORKFLOW.md) — enumerate → existence test → classify → report → execute on approval.

## When to fire

User intent (any phrase is enough):

- "clean up stale docs" / "doc janitor" / "doc sweep"
- "audit docs lifecycle" / "compact audits" / "compact plans"
- "are these audits still earning their keep"
- "what's gone stale in `docs/`"
- "delete tombstones" / "no tombstones, please"
- "promote / lift / retire `<doc>`"
- "is this audit closed properly"
- "post-merge docs cleanup on PR #N"

Also fire **proactively** when:

- Closing a Plan, Audit, or Research file via [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md), or any normal commit that ships a tracked roadmap item.
- A repo-wide refactor changes paths or symbol names cited from docs (cross-reference rot risk).

## Scope

The two surface tiers codemap has today:

| Tier                     | Substrate                                               | Sweep scope                                                                                                                        |
| ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **B** — repo-wide        | `docs/`                                                 | All 5 lifecycle types: `architecture.md`, `roadmap.md`, `glossary.md`, `agents.md`, etc. + `plans/`, `research/`, future `audits/` |
| **0** — per-tooling-area | `.agents/`, `.cursor/`, `scripts/`, `templates/agents/` | Each rule + skill — apply existence test; check Tier 1 always-on cost still earns its keep                                         |

(Tier C / Tier A from `docs-governance` don't apply yet — see [`docs-governance` LIFECYCLE § Doc-bearing surface tiers](../docs-governance/LIFECYCLE.md#doc-bearing-surface-tiers).)

Default: the user names a surface (e.g. "sweep `docs/research/`"). If they say "sweep docs" without scope, ask.

## Classification tiers

| Tier                  | Verdict                                                                                                         | Action                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Keep verbatim** | Cited from source by rule number / section anchor; OR Reference / Roadmap that lives forever per its lifecycle  | No-op (open audits may carry a "Last verified" date — refresh only while findings are open)                                                                                                    |
| **B — Slim + keep**   | Closed but ≥1 audit keep-criteria applies; OR has cited content that's stable                                   | Slim to cited / durable bits + verification recipe + status header; preserve cited rule numbers per [LIFECYCLE § 7](../docs-governance/LIFECYCLE.md#7-cross-reference-preservation-discipline) |
| **C — Delete + lift** | Closed AND no source cites AND all findings shipped/lifted; OR superseded; OR fails the existence test outright | Lift any orphan-able knowledge into the natural reference doc / skill; fix inbound cross-refs; **delete the file** (no tombstones, no pointer rows, no recovery instructions in living docs)   |

## Anti-patterns

- ❌ **Deleting without surfacing the classification first.** The user owns the call. The skill produces evidence; it does not unilaterally decide.
- ❌ **Slimming without grepping for cited rule numbers / section anchors.** Anchor breakage is silent and degrades over time. [docs-governance LIFECYCLE § 7](../docs-governance/LIFECYCLE.md#7-cross-reference-preservation-discipline) is non-negotiable.
- ❌ **Leaving tombstones.** A "this audit was closed and deleted, see commit X" pointer file IS the dead weight the sweep is supposed to eliminate. Trust `git log --follow`.
- ❌ **Lifting trivia.** Not every closed audit has knowledge worth lifting. If findings are 100% mechanical and the result is visible in source, **lift nothing, delete the file.**
- ❌ **Reformatting "while we're here."** A sweep edits structure (delete / slim / lift / pointer-update). Cosmetic re-flowing is a separate PR.
- ❌ **Sweeping Tier 1 rules without checking the always-on cost ledger.** A Tier 1 rule that no longer earns its always-on cost should demote to Tier 2 / Tier 3 (per [`agents-tier-system`](../../rules/agents-tier-system.md)), not get deleted outright.
- ❌ **Leaving enumerated cross-reference indexes inline after a slim.** A line like _"Cited from `audit.md`, `audits/<x>.md`, `testing.md`"_ is a hand-maintained index that drifts on every slim. The grep command IS the index — cite the command (`rg "<anchor>" <scope>`).
- ❌ **Citing specific audit / plan / research filenames as canonical examples.** Skills are durable; the docs they describe are mortal under this very lifecycle. Use shape placeholders. Same hazard for rules — see [`agents-tier-system` § Authoring discipline: durability](../agents-tier-system/SKILL.md#authoring-discipline-durability).

## Reference

- [`docs-governance`](../docs-governance/SKILL.md) — the spec this skill operationalises.
- [`docs-governance` LIFECYCLE](../docs-governance/LIFECYCLE.md) — lifecycle types, existence test, closing prescriptions, cross-reference discipline.
- [`docs-governance` rule](../../rules/docs-governance.md) — Tier-2 priming on every doc-touching edit.
- [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) — natural caller; closes audits and triggers a sweep on the surrounding `audits/` folder.
- [WORKFLOW.md](./WORKFLOW.md) — 5-step procedure + output substrate.
- [`agents-tier-system`](../../rules/agents-tier-system.md) — applies when sweeping Tier 0 (`.agents/rules/`, `.agents/skills/`).
