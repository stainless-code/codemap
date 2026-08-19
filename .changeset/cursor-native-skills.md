---
"@stainless-code/codemap": patch
---

Stop mirroring skills into `.cursor/skills` during `codemap agents init`. Cursor loads skills from `.agents/skills/` natively, so the extra copies double-registered.
