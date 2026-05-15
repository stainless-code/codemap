---
"@stainless-code/codemap": minor
---

`codemap skill` / `codemap rule` — live-served agent content. Consumer-disk `.agents/skills/codemap/SKILL.md` and `.agents/rules/codemap.md` are now **thin pointer files** (~16-22 lines); the full content is served live by the installed binary, so `bun update @stainless-code/codemap` automatically refreshes what agents see without re-running `agents init`.

**Three transports, one engine:**

- **CLI:** `codemap skill` / `codemap rule`
- **MCP:** resources `codemap://skill` / `codemap://rule`
- **HTTP:** `GET /resources/{encoded-uri}` against `codemap serve`

All three resolve through the same `assembleAgentContent(kind)` function. MCP and HTTP share a lazy per-process cache.

**Section assembler with `*.gen.md` renderers:** `templates/agent-content/<kind>/*.md` files concatenate in lexical name order. Files ending in `.gen.md` route through `RENDERERS` in `src/application/agent-content.ts` — today, `20-recipes.gen.md` regenerates the recipe catalog from `listQueryRecipeCatalog()` on every fetch, and `30-schema.gen.md` regenerates table DDL from `createTables()`. Adding a recipe under `templates/recipes/` or a column in `src/db.ts` now surfaces in the served skill automatically with **zero template edits**.

**Pointer protocol + staleness detection:** every consumer-disk pointer carries `<!-- codemap-pointer-version: N -->`. On startup, codemap scans the consumer's `.agents/{skills/codemap/SKILL,rules/codemap}.md`; if the stamp is `< EXPECTED_POINTER_VERSION` (or absent on a fat legacy file > 50 lines), a one-line stderr nag prints with the fix command (`codemap agents init --force`). Warning is stderr-only so `codemap skill > file.md` stays clean.

**Rule trimmed to priming surface:** the always-on rule shrank from 248 → 102 lines (~70% token reduction per turn) — STOP banner + trigger patterns table + top-11 quick reference queries + pointer to the skill for full reference. CLI command table / MCP narrative / audit + apply detail moved into the skill where they belong (on-demand, not every-turn).

**Migration:** existing consumers re-run `codemap agents init --force` to swap their fat `.agents/` files for the new pointer templates (the staleness nag prompts them on first invocation).
