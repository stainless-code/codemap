---
description: Cite open specs / primitive sources when authoring plan PRs and bundled recipes. Codemap inspirations come from the free and open internet (LSP, SQLite, oxc, MCP), not code-by-code cloning of peer tools. Use during plan / recipe authoring under docs/plans/ or templates/recipes/.
globs:
  - "docs/plans/**"
  - "templates/recipes/**"
alwaysApply: false
---

# Plan-PR inspiration discipline

When authoring under `docs/plans/**` or `templates/recipes/**`, cite **open specs** and **primitive sources**, not peer-tool implementations.

Codemap occupies a specific niche in the SQLite-backed-code-index cohort (peers: `srclight`, `Sverklo`, `ctxpp`, `KotaDB`, `codemogger`, etc.). Differentiation is intrinsic — predicate-as-API + pure structural + JS/TS/CSS-ecosystem-deep extraction. Cloning peer features dilutes the niche; reaching for the underlying spec keeps the design grounded.

## Top inspiration sources

| Source                                                                              | When to consult                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LSP spec](https://microsoft.github.io/language-server-protocol/)                   | Before any agent / editor integration shape (`Diagnostic[]`, `code_action`, `code_lens`, `hover`, custom notification mechanism). Protocol authority.                                              |
| [SQLite docs](https://www.sqlite.org/docs.html) (FTS5, virtual tables, WAL, PRAGMA) | Before any schema change — `WITHOUT ROWID`, FTS5, WAL implications, query optimiser behaviour. Authoritative for any schema decision.                                                              |
| [oxc](https://oxc.rs) AST node reference                                            | Before any new `symbols` column or extraction (complexity counters, future per-symbol facts) — node kinds, traversal patterns.                                                                     |
| [Lightning CSS docs](https://lightningcss.dev/)                                     | Before any CSS extraction surface change — visitor API, selector parsing.                                                                                                                          |
| [JSON-RPC 2.0](https://www.jsonrpc.org/specification) + MCP spec                    | Before any MCP tool / resource addition — message envelope, error shape.                                                                                                                           |
| [TC39 proposals](https://github.com/tc39/proposals) + tsgo / tsc release notes      | Before any TS-syntax-sensitive parser work — language additions that affect AST shape.                                                                                                             |
| Existing codemap surface (`docs/architecture.md`, `--recipes-json`, `db.ts`)        | Always before extending — every recipe / column / engine should compose with what's already shipped, not duplicate it.                                                                             |
| Internal third-party graph audits (when run)                                        | Source of grounded failure modes (e.g. closed-dead-subgraph cases — N-file packs with self-imports where no file is reachable from a real entry point). Anonymous; cite the pattern, not the repo. |

Pick-specific sources — VSCode Extension API, peer-tool LSP implementations, etc. — belong in the plan PR that needs them, not in this rule. Inline-cite them where they apply.

## Cite-the-source discipline

Plan PRs cite the relevant spec / primitive source they took inspiration from in the plan body. Examples:

- _"Plugin contract shape mirrors [JSON-RPC 2.0 envelope](https://www.jsonrpc.org/specification#request_object) — keeps validation predictable."_
- _"FTS5 tokeniser choice (`porter unicode61`) per [SQLite FTS5 docs § Tokenizers](https://www.sqlite.org/fts5.html#tokenizers)."_
- _"Recipe pagination follows [SQL standard `OFFSET` semantics](https://www.sqlite.org/lang_select.html#limitoffset)."_

Do **not** cite peer-tool source paths (e.g. `srclight/srclight/blob/main/...`) as the rationale for a design choice. Peer-tool code is a downstream artifact of the same upstream specs we should be reading; cloning it ships their decisions, not ours.

## When NOT to cite a peer

If a plan PR's rationale reads "X tool does Y, so we should too" — stop. Either:

1. The underlying spec / primitive supports Y → cite that spec instead.
2. The underlying spec doesn't support Y → reconsider whether it fits codemap's niche.

The exception: empirical evidence about user demand (e.g. _"Three peers all expose `findReferences` in their MCP tool taxonomy → real signal of agent demand"_). That's market research, not implementation cloning. State the demand explicitly; don't smuggle peer-design choices through as user-driven.

## Reference

- Cohort positioning + differentiation axes (predicate-as-API + pure structural + JS/TS/CSS-deep extraction): see this rule's intro paragraph above.
- Tier system rationale (this is a Tier-2 rule): [`agents-tier-system`](./agents-tier-system.md).
- File-layout convention: [`agents-first-convention`](./agents-first-convention.md).
