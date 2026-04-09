---
description: When creating or moving rules/skills, always store the source file in .agents/ and symlink from .cursor/
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

## Skills (`SKILL.md` files)

1. Create the directory and file in `.agents/skills/<name>/SKILL.md`
2. Create a symlink in `.cursor/skills/`:

   ```bash
   ln -s ../../.agents/skills/<name> .cursor/skills/<name>
   ```

## Why

- `.agents/` is the **source of truth** — it is IDE-agnostic and works across different AI coding tools.
- `.cursor/` only contains **symlinks** pointing back to `.agents/`.
- This keeps configuration portable and avoids duplication.

## Never

- Never place original rule/skill content directly in `.cursor/rules/` or `.cursor/skills/`.
- Never create a rule or skill without both the `.agents/` file and the `.cursor/` symlink.
