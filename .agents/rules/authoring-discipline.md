---
description: Authoring discipline for code comments, docs, and committed prose — preserve existing comments, keep new prose concise.
alwaysApply: true
---

# Authoring discipline (STOP)

**Prose depth:** [`authoring-discipline/PROSE.md`](../skills/authoring-discipline/PROSE.md). **Doc lifecycle:** [`docs-governance`](../skills/docs-governance/SKILL.md).

## Preserve existing source comments (non-negotiable)

1. **Never remove comments** — preserve when editing; update if outdated, don't delete.
2. **Never remove TODO / FIXME / HACK** — ask user before removing completed TODOs.
3. **Never remove commented-out code** — ask before removal.
4. **StrReplace** — copy comments into `new_string`; move comments when restructuring.

User-requested **doc audits** may slim redundant markdown; preservation above applies to **source** comments only.

## New prose (defaults)

- **Decision test:** could a teammate re-derive this in 30s? → cut it (details in [`PROSE.md`](../skills/authoring-discipline/PROSE.md)).
- **JSDoc as types (`.mjs`, `@ts-check`):** `@typedef`, `@param`, `@returns`, inline `@type` are the type system — keep them; apply the decision test only to prose in those blocks.
- **End-of-turn:** cut duplicate tables/narration; after doc slim → [`docs-governance`](../skills/docs-governance/SKILL.md) slimming audit.

Related: [`concise-reporting`](./concise-reporting.md) · [`docs-lifecycle-sweep`](../skills/docs-lifecycle-sweep/SKILL.md).
