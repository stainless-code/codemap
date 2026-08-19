# `.agents/` — rules & skills

Source of truth for AI agent configuration. Cursor loads skills from `.agents/skills/` natively and rules via `.cursor/rules/*.mdc` → `.agents/rules/*.md` symlinks.

## Start here

| Question                               | Read                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| Repo-root stub (cross-tool)            | [`AGENTS.md`](../AGENTS.md)                                           |
| Where files live, rule `.mdc` symlinks | [rules/agents-first-convention.md](rules/agents-first-convention.md)  |
| Tier 1 / 2 / 3 attachment modes        | [rules/agents-tier-system.md](rules/agents-tier-system.md)            |
| Codemap tier/pairing deltas            | [skills/writing-agents-config](skills/writing-agents-config/SKILL.md) |
| Authoring new rules/skills (meta)      | [`writing-great-skills`](skills/writing-great-skills/SKILL.md)        |
| Unslop (always-on)                     | [`unslop`](skills/unslop/SKILL.md)                                    |
| Past corrections                       | [`lessons.md`](lessons.md)                                            |
| What exists on disk right now          | `ls .agents/rules` · `ls .agents/skills`                              |

## Tier legend (summary)

| Tier  | Attachment            | Cost                           |
| ----- | --------------------- | ------------------------------ |
| **1** | `alwaysApply: true`   | Every turn                     |
| **2** | `globs:`              | When matching files in scope   |
| **3** | `description:` intent | When user/agent intent matches |

## Inventory

Discover on disk via `ls` + the frontmatter audit in [`agents-tier-system`](rules/agents-tier-system.md) — no hardcoded name lists.

## Conventions

- **`-priming` suffix** when a Tier-2 rule filename ≠ skill folder name (`architecture-priming` ↔ `improve-codebase-architecture` + `audit-pr-architecture`). Same-name pairings skip the suffix (`docs-governance` rule ↔ `docs-governance` + `docs-lifecycle-sweep` skills).
- **No `AGENTS.md` in skill folders** — use `FULL-GUIDE.md` or topic siblings (`WORKFLOW.md`, `REFERENCE.md`, `LIFECYCLE.md`, `LANGUAGE.md`, `PROSE.md`, `GLOSSARY.md`) for bulk reference. Repo root `AGENTS.md` is a thin stub only.
- **Thin rules** (~10–40 lines); depth in `SKILL.md` or siblings.

## Layout

```text
.agents/
  rules/<name>.md          → .cursor/rules/<name>.mdc (symlink)
  skills/<name>/SKILL.md   → Cursor reads in place
  lessons.md               → .cursor/rules/lessons.mdc (symlink)
```
