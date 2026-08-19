---
description: When creating or moving rules/skills, store the source in .agents/. Rules need a .cursor/rules .mdc symlink. Skills do not — Cursor reads .agents/skills/ natively.
alwaysApply: true
---

# Agents-First File Convention

When creating **any** new rule or skill, follow this convention:

## Rules (`.md` files)

1. Create the file in `.agents/rules/<name>.md` (with YAML frontmatter)
2. Create a `.mdc` symlink in `.cursor/rules/` (Cursor requires `.mdc` for frontmatter parsing):

   ```bash
   ln -s ../../.agents/rules/<name>.md .cursor/rules/<name>.mdc
   ```

**Naming:** Tier-2 priming rules that pair with a skill use `<skill-slug>-priming.md` when the rule name would otherwise differ from the skill folder. When names already match, no suffix.

## Skills (`SKILL.md` files)

Create `.agents/skills/<name>/SKILL.md` only — never start in `.cursor/skills/`. Cursor loads `.agents/skills/` natively. Do **not** symlink into `.cursor/skills/` (double-registers). If `/create-skill` writes there, move the folder to `.agents/skills/` and delete the `.cursor/` copy.

**Never** name bulk reference files `AGENTS.md` inside skill folders — use `FULL-GUIDE.md` or topic siblings.

## Why

- `.agents/` is the **source of truth** — it is IDE-agnostic and works across different AI coding tools.
- `.cursor/rules/` contains **`.mdc` symlinks** pointing back to `.agents/rules/`. Skills are not mirrored there.
- This keeps configuration portable and avoids duplication.

## Never

- Never place original rule content directly in `.cursor/rules/`.
- Never create a rule without both the `.agents/` file and the `.cursor/rules/<name>.mdc` symlink. Skills need `.agents/` source only.

Related: [`agents-tier-system.md`](./agents-tier-system.md) · [`AGENTS.md`](../../AGENTS.md).
