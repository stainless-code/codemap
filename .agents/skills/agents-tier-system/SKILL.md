---
name: agents-tier-system
description: Full tier assignments, pairing conventions, and authoring checklist for .agents/ rules and skills. Use when creating or reviewing a rule or skill, deciding Tier 1 vs 2 vs 3, or auditing attachment cost.
---

# `.agents/` tier system — full reference

Always-on priming: [`.agents/rules/agents-tier-system.md`](../../rules/agents-tier-system.md). Entry points: [`AGENTS.md`](../../../AGENTS.md), [`agents-first-convention`](../../rules/agents-first-convention.md), [`writing-agents-config`](../writing-agents-config/SKILL.md).

## Discover on disk (do not maintain partial catalogs here)

| Tier       | How to list                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| **Tier 1** | Frontmatter audit in [`agents-tier-system` rule](../../rules/agents-tier-system.md) — budget set there |
| **Tier 2** | `ls .agents/rules/*.md` + `globs:` in frontmatter                                                      |
| **Tier 3** | `alwaysApply: false`, no `globs:` — intent via `description`                                           |
| **Skills** | `ls .agents/skills` — runtime discovery via descriptions                                               |

**Pairing examples in this repo:** `consumer-surfaces` (Tier 1, always-on); `docs-governance` (Tier 2 globs) ↔ `docs-governance` + `docs-lifecycle-sweep`; `architecture-priming` ↔ `improve-codebase-architecture` + `audit-pr-architecture`; `agents-tier-system` rule + skill; `authoring-discipline` rule + `PROSE.md`; `verify-after-each-step` rule + skill; `codemap` (skill-only); `harden-pr` (skill-only).

**Caution:** avoid stacking broad globs without thin priming bodies.

## Authoring guidelines

### Adding a new rule

1. **Decide the tier** before writing.
2. **Tier 1 needs justification** — every turn? If file/intent scoped, demote to Tier 2 or Tier 3.
3. **Tier 2 globs** — broadest meaningful scope; pair with skill when applicable.
4. **Source + symlink** per [`agents-first-convention`](../../rules/agents-first-convention.md).

### Adding a new skill

1. **Needs a rule?** Hard `NEVER`/`ALWAYS` + file-scoped work → Tier 2 priming rule.
2. **Skill-only** — explicit trigger phrases in description.
3. **User-only orchestrator** — `disable-model-invocation: true` + delegate to model skill.
4. **Size** — [`writing-agents-config`](../writing-agents-config/SKILL.md) § SKILL.md size tiers.

### Tier 1 audit command

```bash
for f in .agents/rules/*.md .agents/lessons.md; do
  awk '/^---$/{c++; next} c==1 && /^alwaysApply: true$/{found=1; exit} END{exit !found}' "$f" && echo "$f"
done
```

**Done when:** tier choice justified; pairing checklist satisfied; Tier-1 audit command run when adding always-on rules.

## Authoring discipline: durability

Rules and skills are **more durable** than the artifacts they describe. They outlive specific files, specific commit hashes, specific code shapes. Authoring them as if they were short-lived is the most common way they go stale.

Three concrete sub-rules:

1. **Don't cite specific audit / plan / research filenames as canonical examples.** Audits and plans are mortal under [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md) (Tier C delete or Tier B slim). The first time the doc janitor retires a file your skill named, the skill's example rots. Use shape placeholders (`<YYYY-MM-DD>-<topic>.md`, `<topic>.md`) and describe the **shape** of what the next reader should look for ("the most recent audit under `docs/audits/`"), not which file does it today. **Reference docs (`README.md`, `architecture.md`, `glossary.md`, `roadmap.md`, `agents.md`) ARE durable** — citing them by name is fine; they live forever per their lifecycle type.
2. **Don't cite specific commit hashes or PR numbers as the only path to context.** Hashes and PR URLs are stable but opaque. If the context matters, summarise it inline. Hashes are good as **secondary** anchors ("the seed datapoint, commit `<hash>`") not primary ones.
3. **Don't cite specific source-code line numbers.** Same drift as above; lines move on every edit. Reference symbols by name. (Same hazard as [`docs/README.md` Rule 7](../../../docs/README.md) — universal, not codemap-specific.)

When in doubt: if the prose still reads correctly six months from now after every doc you didn't write got rewritten or deleted, the skill is durable. If it reads as a stale snapshot, slim the citations to placeholders.

## Reference

- Skill authoring SSOT: [`writing-great-skills`](../writing-great-skills/SKILL.md)
- Codemap deltas: [`writing-agents-config`](../writing-agents-config/SKILL.md)
- File-layout: [`agents-first-convention.md`](../../rules/agents-first-convention.md)
- Tier-1 priming rule: [`.agents/rules/agents-tier-system.md`](../../rules/agents-tier-system.md)
