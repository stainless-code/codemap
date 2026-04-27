# Lessons

Persistent log of corrections and insights from past sessions. Agents **must** check this file at the start of every session and append new lessons after corrections.

## Format

Each entry is a single bullet: `- **<topic>** — <lesson>`. Newest entries at the bottom.

## Lessons

- **changesets bump policy (pre-v1)** — while in `0.x`, default to **patch** for everything (additive features, fixes, docs, internal refactors); reserve **minor** for schema-breaking changes that force a `.codemap.db` rebuild (matches 0.2.0 precedent: new tables/columns/`SCHEMA_VERSION` bump). Strict SemVer kicks in only after `1.0.0`. Don't propose `minor` just because new CLI commands or public types were added.
