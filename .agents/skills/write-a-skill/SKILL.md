---
name: write-a-skill
description: Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill (or asks "how do I write a skill?", "draft a SKILL.md for X").
---

# Writing skills

Codemap-specific deltas for authoring `.agents/skills/<name>/SKILL.md`. **Read [`writing-great-skills`](../writing-great-skills/SKILL.md) first** for generic principles — invocation, information hierarchy, progressive disclosure, pruning, leading words, failure modes.

## Repo conventions you must respect

These trump anything generic:

- **File layout** — [`agents-first-convention`](../../rules/agents-first-convention.md): source of truth is `.agents/skills/<name>/SKILL.md`; `.cursor/skills/<name>` is a **symlink** back. Never put original content under `.cursor/`.
- **Tier choice** — [`agents-tier-system`](../../rules/agents-tier-system.md): Tier 1 (always-on + rule), Tier 2 (glob-attached + rule), or Tier 3 (discoverable, no rule). Skills with `NEVER` / `ALWAYS` clauses deserve a rule pairing. Pure intent-trigger skills stay Tier 3.
- **Maintainer-only vs shipped** — `.agents/skills/` is the dev-side mirror; `templates/agents/skills/` is what `codemap agents init` ships. The bundled template surface today is **only** the `codemap` skill — every other skill in `.agents/skills/` is maintainer-only (precedent: PR #25). Don't add to `templates/agents/` unless every npm consumer would want it. Consumer-surface policy: [`.agents/rules/consumer-surfaces.md`](../../rules/consumer-surfaces.md).

## Process

### 1. Gather requirements

Ask the user:

- What task / domain does the skill cover?
- What specific use cases should it handle?
- Does it need executable scripts (under `scripts/`) or just instructions?
- Any reference materials to include?
- **Tier choice**: always-on principles (`NEVER` / `ALWAYS` clauses)? If yes → Tier-1 or Tier-2 rule pairing per [`agents-tier-system`](../../rules/agents-tier-system.md).

Use [`grill-me`](../grill-me/SKILL.md) on yourself before drafting — trigger phrase shape, boundary with adjacent skills, durability test (still correct six months from now?).

### 2. Draft the skill

Apply [`writing-great-skills`](../writing-great-skills/SKILL.md) for structure, description, disclosure, and split decisions. Codemap precedents for companion files:

- [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) — `LANGUAGE.md`, `DEEPENING.md`, `INTERFACE-DESIGN.md`, `REFERENCE.md`
- [`pr-comment-fact-check`](../pr-comment-fact-check/SKILL.md) — slim `SKILL.md` + `WORKFLOW.md` (gh/graphql fetch + triage flow split out)
- [`harden-pr`](../harden-pr/SKILL.md) — slim `SKILL.md` + `WORKFLOW.md` + `LEDGER.md`

### 3. Wire the file layout

```bash
# Source of truth
.agents/skills/<name>/SKILL.md

# Cursor symlink (per agents-first-convention)
ln -s ../../.agents/skills/<name> .cursor/skills/<name>
```

### 4. Tier placement

Tiers are discovered on disk via the frontmatter audit (see [`agents-tier-system` skill](../agents-tier-system/SKILL.md)) — there is no name list to update. Just set the new skill's frontmatter correctly: `alwaysApply: true` (Tier 1, needs a rule), `globs:` (Tier 2, needs a rule), or `description:`-only (Tier 3, no rule).

### 5. Review

Run the [checklist](#checklist) before declaring done.

## Durability discipline

Per [`agents-tier-system` § Authoring discipline: durability](../agents-tier-system/SKILL.md#authoring-discipline-durability):

- **Don't cite specific audit / plan / research filenames as canonical examples.** Plans are mortal under [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md). Use shape placeholders (`<topic>.md`) instead.
- **Don't cite specific commit hashes or PR numbers as the only path to context.** Summarise inline.
- **Don't cite source-code line numbers.** Reference symbols by name.

If the skill still reads correctly six months from now after every doc you didn't write got rewritten, it's durable.

## Checklist

- [ ] Read [`writing-great-skills`](../writing-great-skills/SKILL.md) — description, hierarchy, disclosure applied
- [ ] File layout follows [`agents-first-convention`](../../rules/agents-first-convention.md) (`.agents/` source + `.cursor/` symlink)
- [ ] Tier choice documented per [`agents-tier-system`](../../rules/agents-tier-system.md); rule pairing if `NEVER` / `ALWAYS` clauses
- [ ] Frontmatter tier mode set correctly (`alwaysApply` / `globs` / `description`-only) — discoverable via the `agents-tier-system` audit
- [ ] Decision recorded in the PR description: maintainer-only (`.agents/` only) vs shipped (`templates/agents/` too)
- [ ] No time-sensitive info; durable citations only (see [Durability discipline](#durability-discipline))
