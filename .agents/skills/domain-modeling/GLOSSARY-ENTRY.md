# Glossary entry format

Canonical ubiquitous language for `@stainless-code/codemap`. Lives in [`docs/glossary.md`](../../../docs/glossary.md) — single repo-wide file (Tier B). Add an entry when a term is resolved during grilling or implementation.

## Structure

```md
# Glossary

> Single canonical glossary for terms used across `src/` and `docs/`.
> When in doubt, this file wins. Update on the same PR that introduces a new term.

## <Group name>

| Term       | Definition                                                    | Aliases / avoid      |
| ---------- | ------------------------------------------------------------- | -------------------- |
| **<term>** | One-sentence definition. Define what it IS, not what it does. | comma-separated list |
```

## Rules

- **Be opinionated.** Pick one canonical term; list alternatives under "Aliases / avoid".
- **Keep definitions tight.** One sentence — what it IS, not what it does.
- **Domain terms only.** General programming concepts don't belong.
- **Group under subheadings** when natural clusters emerge (`## Index`, `## Recipes`, `## Schema`, `## Adapters`).
- **Flag ambiguities** in a § Flagged ambiguities section — "In this repo, X always means …"
- **Cite, don't paste** — link source files by path (no line numbers).

## Where vocabulary lives

| Scope              | File                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Repo-wide domain   | `docs/glossary.md` (single)                                                                             |
| Architecture nouns | `improve-codebase-architecture/LANGUAGE.md` (`module`, `seam`, `adapter`) — distinct from this glossary |

## Decisions (not in the glossary)

| Kind                | Location                              |
| ------------------- | ------------------------------------- |
| Current structural  | `docs/architecture.md`                |
| Closed / historical | `docs/audits/<YYYY-MM-DD>-<topic>.md` |
| In-flight           | `docs/plans/<name>.md`                |

See [`docs-governance`](../docs-governance/SKILL.md) — no `docs/adr/` in this repo.
