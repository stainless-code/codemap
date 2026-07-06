---
name: writing-agents-config
description: Codemap repo hybrid deltas for .agents/ — tiers, rule-skill pairing, repo exemplars. Use when creating or reviewing rules/skills in this repo. Read writing-great-skills first for skill vocabulary and authoring principles.
disable-model-invocation: true
---

# Writing agents config

**Read first:** [`writing-great-skills`](../writing-great-skills/SKILL.md) — invocation, information hierarchy, completion criteria, pruning, failure modes.

This repo adds **Cursor rules** (Tier 1/2/3) on top of a skills-only agent model — always-on STOP rules where cross-turn non-negotiables beat description-only triggers.

**Tier framework:** [`agents-tier-system`](../agents-tier-system/SKILL.md) · **Layout:** [`agents-first-convention`](../../rules/agents-first-convention.md).

## Attachment decision tree

1. **Every turn, non-negotiable?** → Tier 1 (`alwaysApply: true`) — **≤40 lines** STOP + pointers
2. **File-scoped pattern?** → Tier 2 (`globs:`) — thin priming; depth in paired skill
3. **Intent-only workflow?** → Tier 3 or skill-only — no always-on tax (bug diagnosis, doc sweeps, structural queries)
4. **User slash-command only?** → `disable-model-invocation: true` wrapper → model skill(s)

## Pairing checklist

| Check           | Pass when                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Priming size    | Rule ~10–40L; procedures in skill or sibling                                                                            |
| Bidirectional   | Rule → skill in Reference; skill → rule where paired                                                                    |
| No duplication  | SSOT in skill; rule has STOP rows or pointers only                                                                      |
| Inventory drift | Tier-1 set discovered via the frontmatter audit in `agents-tier-system` rule — not hardcoded name lists in README/skill |
| Triggers        | Per `writing-great-skills` — one branch per intent in `description`                                                     |

## SKILL.md size tiers

Rules cap at **≤40L**; skills use progressive disclosure (`writing-great-skills` **sprawl**). Line count is a **hygiene signal**, not a hard gate — split for structure, not to hit a number.

| Lines      | Target                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------ |
| **≤60**    | Default for **new** skills                                                                       |
| **61–120** | OK for one **single-path** workflow with checkable completion criteria                           |
| **>120**   | **Audit** — review for sprawl; disclose to siblings when structure says split                    |
| **>140**   | **Split** unless an explicit bulk reference hub (`FULL-GUIDE.md`, `WORKFLOW.md`, `REFERENCE.md`) |

**Split when:** branching paths, reference encyclopedia in `SKILL.md`, **premature-completion** risk, or **sediment** — disclose to siblings (`WORKFLOW.md`, `REFERENCE.md`, `LANGUAGE.md`, `PROSE.md`).

**Don't split when:** every line is ordered steps for one branch; splitting forces a multi-file hop mid-checklist.

```bash
# Review tail (>120L) — split only when table above says so
find .agents/skills -name SKILL.md -exec sh -c 'n=$(wc -l < "$1"); [ "$n" -gt 120 ] && printf "%3d %s\n" "$n" "$1"' _ {} \;
```

## Repo exemplars

`consumer-surfaces` (Tier 1, always-on), `tracer-bullets` (rule), `docs-governance` (Tier 2 globs + skill + `docs-lifecycle-sweep`), `architecture-priming` ↔ `improve-codebase-architecture` + `audit-pr-architecture`, `codemap` (skill-only), `harden-pr` (SKILL + `LEDGER.md`), `authoring-discipline` (rule + `PROSE.md`), `verify-after-each-step` (slim rule + skill), `agents-tier-system` (rule + skill), `pr-comment-fact-check` (rule + skill).

## User-only router

[`ask-agents`](../ask-agents/SKILL.md) — `grill-me`, `grill-with-docs`, `writing-great-skills`, `writing-agents-config`. Wrappers **≤10 lines**.

## Codemap-specific tradeoffs

- **Tier-2 attach** — `agents-tier-system` (`agents/**` + `cursor/**`); `docs-governance` (`docs/**`, `.agents/**`); `architecture-priming` when authoring structural refactors.
- **Intent-only skills** — `improve-codebase-architecture`, `domain-modeling`, `docs-lifecycle-sweep`, `diagnose`, `tdd`, `pr-comment-fact-check`, `harden-pr`, `codemap`, `audit-pr-architecture`. No glob (no per-file tax).
- **Ship policy** — `templates/agent-content/**` is served live (CLI/MCP/HTTP); `templates/agents/**` is copied by `codemap agents init`. Consumer surfaces describe behavior only ([`consumer-surfaces`](../../rules/consumer-surfaces.md)).
- **Symlink convention** — source under `.agents/`; `.cursor/rules/<name>.mdc` and `.cursor/skills/<name>` are symlinks only.
- **Cross-skill links** — relative `../skill/SKILL.md` and sibling files resolve reliably in Cursor agents. Relative links inside `.agents/` are an **intentional delta**, not drift.
- **Indexer-first exploration** — skills that explore structure prefer `codemap query` over grep; the `codemap` rule is Tier 1 always-on.

## Anti-patterns

- ❌ Fat always-on rule with procedures (slim → skill)
- ❌ README skill inventories that drift (discover via `ls` + frontmatter audit)
- ❌ Maintainer internals on consumer surfaces (`templates/agent-content`, changesets, CLI help)
- ❌ External-monorepo artifact leakage in examples — use `src/`, index/recipe seams, `bun` scripts, `origin/main`

## Reference

- Skill authoring SSOT: [`writing-great-skills`](../writing-great-skills/SKILL.md)
- Tiers + audit: [`agents-tier-system`](../agents-tier-system/SKILL.md)
- Docs lifecycle: [`docs-governance`](../docs-governance/SKILL.md)
