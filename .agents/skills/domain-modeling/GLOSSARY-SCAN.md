# Batch glossary scan

Full terminology extraction to [`docs/glossary.md`](../../../docs/glossary.md). For **inline** term pinning during grilling or implementation, use the main [`domain-modeling`](./SKILL.md) session flow — not this file.

## Process

1. **Scan the slice** for domain-relevant nouns, verbs, and concepts. Look at: the index pipeline (`src/parser.ts`, `src/db.ts`, adapters); schema columns and SQLite tables; recipe catalog (`templates/recipes/`); CLI/MCP surfaces (`codemap query`, `codemap apply`); config keys; option names (`--recipe`, `--baseline`, `format`, `group_by`); adapter / language-map names; JSDoc that hints at semantics.
2. **Identify problems**:
   - Same word used for different concepts (ambiguity — e.g. "query" for both a cataloged recipe and ad-hoc SQL).
   - Different words used for the same concept (synonyms — e.g. "index" vs "database" vs "DB").
   - Vague or overloaded terms (e.g. "file" for both a `FileRow` TS shape and the `files` table).
   - A schema column or recipe id bleeding into prose without a domain explanation.
3. **Propose a canonical glossary** with opinionated term choices.
4. **Write to `docs/glossary.md`** following the format in [GLOSSARY-ENTRY.md](./GLOSSARY-ENTRY.md). Link from [`docs/README.md`](../../../docs/README.md) and [`docs/architecture.md`](../../../docs/architecture.md) § Reference.
5. **Output a summary** inline in the conversation.

## Output format

Write the glossary file per [GLOSSARY-ENTRY.md](./GLOSSARY-ENTRY.md). **Group naturally** — by index layer, recipe surface, or schema concern. Don't force groupings if one table is cohesive enough.

```md
# Glossary

> Single canonical glossary for terms used across `src/` and `docs/`.
> When in doubt, this file wins. Update on the same PR that introduces a new term.

## Index

| Term | Definition | Aliases / avoid |

## Recipes

| Term | Definition | Aliases / avoid |

## Flagged ambiguities

- "<term>" was used to mean both **<canonical-A>** and **<canonical-B>**. Recommendation: ...
```

### Groupings (illustrative)

- **Index**: structural index, `.codemap/index.db`, reindex, commit drift, pending sync.
- **Schema**: schema column, `SCHEMA_VERSION`, SQLite table vs TS shape (`FileRow` vs `files` table).
- **Recipes**: recipe (cataloged SQL), query (any SQL), `query_recipe`, golden scenario.
- **Graph**: hub (fan-in), barrel (re-exports), fan-in vs fan-out, impact direction.
- **Parsing**: language adapter, adapter extension, parse worker, extractFileData.
- **Surfaces**: CLI, MCP tool, HTTP resource, `templates/agent-content` (served live) vs `templates/agents` (copied by init).

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as "aliases / avoid."
- **Flag conflicts explicitly** in § Flagged ambiguities.
- **Skip generic programming concepts** unless they have domain meaning here.
- **Skip module / class / file names** unless the name itself is the domain term (e.g. `FileRow` — the name IS the TS shape).
- **Keep definitions tight** — one sentence. Define what it IS.
- **Cite, don't paste** — link source files by path (no line numbers).

## Re-running

When invoked again on a previously-glossarised repo:

1. Read the existing `docs/glossary.md`.
2. Incorporate new terms surfaced by recent PRs.
3. Update definitions if understanding has evolved.
4. Re-flag any new ambiguities.

## Project conventions

- **File location**: `docs/glossary.md` (single, repo-root).
- **Link from**: `docs/README.md` and `docs/architecture.md` § Reference.
- **Distinct from architecture vocabulary**: `improve-codebase-architecture/LANGUAGE.md` covers architecture nouns (`module`, `seam`, `adapter`); this glossary covers index/recipe/schema domain nouns.
