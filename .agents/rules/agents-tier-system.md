---
description: Tier system for .agents/ rules and skills — context-targeted attachment via the right Cursor frontmatter mode. Apply when authoring a new rule or skill, or when reviewing an existing one's attachment cost.
globs:
  - ".agents/rules/**"
  - ".agents/skills/**"
  - ".cursor/rules/**"
  - ".cursor/skills/**"
alwaysApply: false
---

# `.agents/` tier system — priming

Three attachment modes: **always-on** (`alwaysApply: true`), **auto-attached** (`globs:`), **intent** (`description:` only).

**Tier 1 budget:** owner-set; currently ~10 always-on rules + `lessons.md` (≤250 lines total). The frontmatter audit is the source of truth — **no hardcoded Tier 1 name lists** in rule, skill, or README. Audit:

```bash
for f in .agents/rules/*.md .agents/lessons.md; do
  awk '/^---$/{c++; next} c==1 && /^alwaysApply: true$/{found=1; exit} END{exit !found}' "$f" && echo "$f"
done
```

**When authoring:** pick tier before writing; pair fat rules with skills; symlinks per [`agents-first-convention`](./agents-first-convention.md). Default to intent-triggered skills and a thin always-on set.

## Reference

- Full assignments, checklist, pairing examples: [`agents-tier-system` skill](../skills/agents-tier-system/SKILL.md)
- Codemap deltas + size tiers: [`writing-agents-config`](../skills/writing-agents-config/SKILL.md)
- Router index: [`AGENTS.md`](../../AGENTS.md)
- Architecture priming: [`architecture-priming.md`](./architecture-priming.md)
