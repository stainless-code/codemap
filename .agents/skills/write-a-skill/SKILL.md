---
name: write-a-skill
description: Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill (or asks "how do I write a skill?", "draft a SKILL.md for X").
---

# Writing Skills

Discipline for authoring `.agents/skills/<name>/SKILL.md` files in this repo.

## Repo conventions you must respect

Before drafting any skill in codemap, internalise these (they trump anything in this skill):

- **File layout** — [`agents-first-convention`](../../rules/agents-first-convention.md): the source-of-truth file is `.agents/skills/<name>/SKILL.md`; the `.cursor/skills/<name>` entry is a **symlink** back. Never put original content under `.cursor/`.
- **Tier choice** — [`agents-tier-system`](../../rules/agents-tier-system.md): every new skill is Tier 1 (always-on, paired with a rule), Tier 2 (auto-attached to a glob, paired with a rule), or Tier 3 (discoverable, no rule). **Skills with `NEVER` / `ALWAYS` clauses deserve a rule pairing.** Pure intent-trigger skills (no hard "must" clauses) stay Tier 3.
- **Maintainer-only vs shipped** — `.agents/skills/` is the dev-side mirror; `templates/agents/skills/` is what `codemap agents init` ships to npm consumers. The bundled template surface today is **only** the `codemap` skill — every other skill in `.agents/skills/` is maintainer-only (precedent: PR #25). Don't add a skill to `templates/agents/` unless it's something every consumer of the published package would want.

## Process

### 1. Gather requirements

Ask the user:

- What task / domain does the skill cover?
- What specific use cases should it handle?
- Does it need executable scripts (under `scripts/`) or just instructions?
- Any reference materials to include?
- **Tier choice**: does the skill have always-on principles (any `NEVER` / `ALWAYS` clauses)? If yes, it deserves a Tier-1 or Tier-2 rule pairing per [`agents-tier-system`](../../rules/agents-tier-system.md).

### 2. Draft the skill

Create:

- `SKILL.md` with concise instructions (under 100 lines if possible — see "When to split" below)
- Companion files (`LANGUAGE.md`, `REFERENCE.md`, `EXAMPLES.md`, etc.) when content exceeds 100 lines or has distinct domains
- `scripts/<name>.{sh,ts}` when a deterministic operation is invoked repeatedly (saves tokens vs generated code)

Use [`grill-me`](../grill-me/SKILL.md) on yourself to surface decisions before you write — what's the trigger phrase shape? What's the boundary with adjacent skills? What's the durability test (does this skill still read correctly six months from now)?

### 3. Wire the file layout

```bash
# Source of truth
.agents/skills/<name>/SKILL.md

# Cursor symlink (per agents-first-convention)
ln -s ../../.agents/skills/<name> .cursor/skills/<name>
```

### 4. Update the tier list

Add the skill to the relevant list in [`agents-tier-system.md`](../../rules/agents-tier-system.md) so the inventory stays accurate.

### 5. Review

Ask the user:

- Does this cover your use cases?
- Anything missing or unclear?
- Should any section be more / less detailed?

Run the [Review checklist](#review-checklist) before declaring done.

## Skill structure

```text
.agents/skills/<name>/
├── SKILL.md              # Main instructions (required)
├── LANGUAGE.md           # Vocabulary the skill enforces (if any)
├── REFERENCE.md          # Detailed docs (if SKILL.md exceeds ~100 lines)
├── EXAMPLES.md           # Usage examples (if needed)
└── scripts/              # Utility scripts (if needed)
    └── helper.sh
```

## SKILL.md template

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers — verbs and nouns the user is likely to say, plus contexts where the skill applies].
---

# Skill Name

## Quick start

[Minimal working example — what the user does on first invocation]

## Workflows

[Step-by-step processes with checklists for complex tasks]

## Advanced features

[Link to companion files: See [REFERENCE.md](REFERENCE.md) / [LANGUAGE.md](LANGUAGE.md)]
```

## Description requirements

The description is **the only thing the agent sees** when deciding which skill to load. It's surfaced in the discoverable-skills list alongside every other installed skill. Get this right or your skill never fires.

**Goal**: Give the agent just enough info to know:

1. What capability this skill provides
2. When / why to trigger it (specific keywords, contexts, file types)

**Format**:

- Max ~1024 chars
- Write in third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"
- Include the verbs and nouns the user is likely to say (per [`agents-tier-system` § Tier 3 description](../../rules/agents-tier-system.md))

**Good example**:

```text
Triage and fact-check PR review comments against the actual codebase, project rules, and skills. Use when the user asks to address PR comments, respond to reviewer feedback, check if a comment is correct, fact-check a reviewer's claim, decide which comments to push back on, or sort hallucinated suggestions from real ones. Triggers on phrases like "check PR comments", "are these comments right".
```

**Bad example**:

```text
Helps with PRs.
```

The bad example gives the agent no way to distinguish this from any other PR-adjacent skill.

## When to add scripts

Add utility scripts under `scripts/` when:

- Operation is deterministic (validation, formatting, bisection harness)
- Same code would be generated repeatedly across invocations
- Errors need explicit handling that's tedious to re-derive

Scripts save tokens and improve reliability vs generated code.

## When to split files

Split into companion files when:

- `SKILL.md` exceeds ~100 lines
- Content has distinct domains (vocabulary vs process vs templates)
- Advanced features are rarely needed and would balloon the main file

Cite codemap precedents:

- [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) splits into `LANGUAGE.md` (vocab), `DEEPENING.md` (sub-rules), `INTERFACE-DESIGN.md` (parallel-sub-agent pattern).
- [`pr-comment-fact-check`](../pr-comment-fact-check/SKILL.md) stays single-file because every section is in-flow process.

## Durability discipline

Per [`agents-tier-system` § Authoring discipline: durability](../../rules/agents-tier-system.md):

- **Don't cite specific audit / plan / research filenames as canonical examples.** Plans are mortal under [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md). Use shape placeholders (`<topic>.md`) instead.
- **Don't cite specific commit hashes or PR numbers as the only path to context.** Summarise inline.
- **Don't cite source-code line numbers.** Reference symbols by name.

If the skill still reads correctly six months from now after every doc you didn't write got rewritten, it's durable.

## Review checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when…")
- [ ] `SKILL.md` under 100 lines OR has split companion files
- [ ] No time-sensitive info (no "as of 2026-04…")
- [ ] Consistent terminology — drift kills clarity
- [ ] Concrete examples included
- [ ] Cross-references one level deep (don't chain `SKILL.md → REFERENCE.md → DEEP-DIVE.md → REFERENCE2.md`)
- [ ] File layout follows [`agents-first-convention`](../../rules/agents-first-convention.md) (`.agents/` source + `.cursor/` symlink)
- [ ] Tier choice documented per [`agents-tier-system`](../../rules/agents-tier-system.md); rule pairing added if the skill has `NEVER` / `ALWAYS` clauses
- [ ] Skill listed in the appropriate tier section of `agents-tier-system.md`
- [ ] Decision recorded in the PR description: maintainer-only (`.agents/` only) vs shipped (`templates/agents/` too)
