---
"@stainless-code/codemap": patch
---

Update bundled `templates/agents/` rule and skill to cover the recent CLI surface — `codemap query --summary` / `--changed-since <ref>` / `--group-by owner|directory|package`, per-row recipe `actions`, and the new `symbols.visibility` column. The dev-side `.agents/` mirror is updated in lockstep so this clone stays self-consistent.
