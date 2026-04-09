---
"@stainless-code/codemap": patch
---

Use vendor-neutral `.md` extension for agent rules in templates; Cursor integration remaps to `.mdc` at wiring time

- `codemap agents init` now writes `.md` rule files to `.agents/rules/` (plain Markdown with YAML frontmatter)
- Cursor target automatically renames rules to `.mdc` (required for frontmatter parsing); all other targets (Windsurf, Continue, Cline, Amazon Q) keep `.md`
- `SKILL.md` now includes `name` and `description` frontmatter per the Agent Skills spec
