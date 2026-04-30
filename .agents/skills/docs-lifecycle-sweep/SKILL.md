---
name: docs-lifecycle-sweep
description: Operationalises the docs-governance lifecycle on demand — produces a per-file Tier-A (keep verbatim) / Tier-B (slim + keep) / Tier-C (delete + lift) classification with evidence and an executable plan, then carries out the user's chosen actions. Use when the user says "clean up stale docs", "doc sweep", "audit docs lifecycle", "compact audits", "are these audits / plans still earning their keep", "delete tombstones", "doc janitor", "what's gone stale in docs/", "promote / lift / retire <doc>", or asks to enforce the existence test against any `docs/**` or `.agents/**` surface. NEVER deletes a file without surfacing the classification + evidence + cross-reference impact for user approval first.
---

# Docs lifecycle sweep — the doc janitor

[`docs-governance`](../docs-governance/SKILL.md) defines **what** every doc should be. This skill is the **how** — it walks any doc-bearing surface, applies the spec mechanically, and produces a per-file action plan the user approves before anything is touched.

The promise: at the end of a sweep, every remaining file passes the existence test, every closed plan is lifted, every closed audit is either kept-with-justification or deleted-with-knowledge-lifted, every cross-reference still resolves, and there is **no dead weight**.

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

(Tier C / Tier A from `docs-governance` don't apply yet — see [`docs-governance` § Doc-bearing surface tiers](../docs-governance/SKILL.md#doc-bearing-surface-tiers).)

Default: the user names a surface (e.g. "sweep `docs/research/`"). If they say "sweep docs" without scope, ask.

## The 5-step procedure

### 1. Enumerate the surface

```bash
find docs -name '*.md' -type f                                # Tier B
find .agents/rules .agents/skills -name '*.md' -type f        # Tier 0 (source-of-truth rules + skills)
find templates/agents -name '*.md' -type f                    # Tier 0 (bundled npm templates — separate authoring surface)
```

`.cursor/` is intentionally excluded — it's symlinks back to `.agents/` per [`agents-first-convention`](../../rules/agents-first-convention.md), so sweeping it would double-count. `scripts/` is .ts only (no docs to sweep). If either grows tracked `.md` files in the future, add them here.

Map each file to one of the 5 lifecycle types per [docs-governance § 1](../docs-governance/SKILL.md#1-five-lifecycle-types). If a file fits no type, that itself is a finding (rogue doc — fold + delete).

### 2. Apply the existence test

Per [docs-governance § 2](../docs-governance/SKILL.md#2-existence-test-apply-on-every-doc-touching-pr), each file earns its place if it meets ≥1 of: source cite / durable policy / open work / unique historical context.

For each file, run the cite-check evidence command:

```bash
rg -n "<filename>(\.md)?(#[a-z0-9-]+)?" \
   --glob '!docs/**' --glob '!.agents/**' --glob '!.cursor/**' .

rg -n "Rule [0-9]+" <doc-path>           # cited rule numbers
rg -n "NOTE\(<topic>" src/ scripts/      # NOTE markers if used
```

If the file is an audit, also check the [docs-governance § Closing an audit re-derivable test](../docs-governance/SKILL.md#closing-an-audit) keep-criteria (decisions of record / source-back-references / reusable methodology).

### 3. Classify each file

| Tier                  | Verdict                                                                                                         | Action                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Keep verbatim** | Cited from source by rule number / section anchor; OR Reference / Roadmap that lives forever per its lifecycle  | Update "Last verified" header (audits) or no-op                                                                                                                                  |
| **B — Slim + keep**   | Closed but ≥1 audit keep-criteria applies; OR has cited content that's stable                                   | Slim to cited / durable bits + verification recipe + status header; preserve cited rule numbers per [§ 7](../docs-governance/SKILL.md#7-cross-reference-preservation-discipline) |
| **C — Delete + lift** | Closed AND no source cites AND all findings shipped/lifted; OR superseded; OR fails the existence test outright | Lift any orphan-able knowledge into the natural reference doc / skill; update the pointer index; **delete the file** (no tombstones)                                             |

### 4. Surface the classification report (BEFORE any edits)

Present the user with a per-file table — file shape / lifecycle type / tier verdict / evidence / proposed action. Use **shape placeholders** (`<topic>`, `<feature>`) when illustrating the template.

The report includes the **executable diff preview** for every Tier B (slim) and Tier C (delete + lift). Cross-reference impact is shown: every inbound link to a Tier C file gets a "this link will need rewiring" line.

### 5. Execute on user approval

In dependency order (delete + lift before slimming so cross-refs are correct):

1. **Lift** orphan-able knowledge to its destination.
2. **Update** every inbound cross-reference (in-place edits).
3. **Delete** the source file (Tier C) or apply the slim diff (Tier B).
4. **Update pointer index** — `roadmap.md § Closed audits (pointers)` for audits; `architecture.md` for newly-promoted reference content; `docs/README.md § File Ownership` table for added/removed top-level docs (per [`docs/README.md` Rule 4](../../../docs/README.md)).
5. **Re-grep** to confirm zero broken cross-references: `rg "<deleted-filename>"` returns 0 hits outside the deletion commit message.

After execution, the surface is **clean** by definition.

## Output substrate (the sweep report itself)

A sweep report is **transient** by design — it lives on the PR / chat where the sweep ran, not in `docs/`. The findings + chosen actions land as commit messages + cross-link updates; the report itself is not a doc to keep.

If the user wants a durable record, promote it to a one-time entry in `roadmap.md § Closed audits (pointers)` or to a slim `audits/<date>-lifecycle-sweep.md` — but only if the rationale would be hard to reconstruct from `git log --follow`. Default is: don't write a meta-doc about the cleanup.

## Anti-patterns

- ❌ **Deleting without surfacing the classification first.** The user owns the call. The skill produces evidence; it does not unilaterally decide.
- ❌ **Slimming without grepping for cited rule numbers / section anchors.** Anchor breakage is silent and degrades over time. [docs-governance § 7](../docs-governance/SKILL.md#7-cross-reference-preservation-discipline) is non-negotiable.
- ❌ **Leaving tombstones.** A "this audit was closed and deleted, see commit X" pointer file IS the dead weight the sweep is supposed to eliminate. Trust `git log --follow`.
- ❌ **Lifting trivia.** Not every closed audit has knowledge worth lifting. If findings are 100% mechanical and the result is visible in source, **lift nothing, delete the file.**
- ❌ **Reformatting "while we're here."** A sweep edits structure (delete / slim / lift / pointer-update). Cosmetic re-flowing is a separate PR.
- ❌ **Sweeping Tier 1 rules without checking the always-on cost ledger.** A Tier 1 rule that no longer earns its always-on cost should demote to Tier 2 / Tier 3 (per [`agents-tier-system`](../../rules/agents-tier-system.md)), not get deleted outright.
- ❌ **Leaving enumerated cross-reference indexes inline after a slim.** A line like _"Cited from `audit.md`, `audits/<x>.md`, `testing.md`"_ is a hand-maintained index that drifts on every slim. The grep command IS the index — cite the command (`rg "<anchor>" <scope>`).
- ❌ **Citing specific audit / plan / research filenames as canonical examples.** Skills are durable; the docs they describe are mortal under this very lifecycle. Use shape placeholders. Same hazard for rules — see [`agents-tier-system` § Authoring discipline: durability](../../rules/agents-tier-system.md#authoring-discipline-durability).

## Reference

- [`docs-governance`](../docs-governance/SKILL.md) — the spec this skill operationalises.
- [`docs-governance` rule](../../rules/docs-governance.md) — Tier-2 priming on every doc-touching edit.
- [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) — natural caller; closes audits and triggers a sweep on the surrounding `audits/` folder.
- [`agents-tier-system`](../../rules/agents-tier-system.md) — applies when sweeping Tier 0 (`.agents/rules/`, `.agents/skills/`).
