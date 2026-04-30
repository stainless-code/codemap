# Lessons

Persistent log of corrections and insights from past sessions. Agents **must** check this file at the start of every session and append new lessons after corrections.

## Format

Each entry is a single bullet: `- **<topic>** — <lesson>`. Newest entries at the bottom.

## Lessons

- **changesets bump policy (pre-v1)** — while in `0.x`, default to **patch** for everything (additive features, fixes, docs, internal refactors); reserve **minor** for schema-breaking changes that force a `.codemap.db` rebuild (matches 0.2.0 precedent: new tables/columns/`SCHEMA_VERSION` bump). Strict SemVer kicks in only after `1.0.0`. Don't propose `minor` just because new CLI commands or public types were added.
- **agent rule + skill maintenance** — when shipping a CLI flag, recipe id, recipe `actions` template, schema column, or any agent-queryable surface, update **both** copies of the codemap rule + skill in the **same PR** per [docs/README.md Rule 10](../docs/README.md): `templates/agents/rules/codemap.md` + `templates/agents/skills/codemap/SKILL.md` (ships to npm) **and** `.agents/rules/codemap.md` + `.agents/skills/codemap/SKILL.md` (this clone's mirror). Drift between the two pairs should be CLI-prefix-only (`codemap` vs `bun src/index.ts`). Forgetting this leaves installed agents with a stale view of the CLI — that's how `--summary` / `--changed-since` / `--group-by` / `actions` / `symbols.visibility` shipped without any `templates/agents/` mention until PR #29 retro-fixed it.
