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

Use [`docs/research/non-goals-reassessment-2026-05.md § 4`](../../docs/research/non-goals-reassessment-2026-05.md#4-inspiration-sources-for-plan-pr-authoring) for the canonical list. Quick reference:

- **[LSP spec](https://microsoft.github.io/language-server-protocol/)** — protocol authority for any agent / editor integration shape.
- **[SQLite docs](https://www.sqlite.org/docs.html)** — FTS5, virtual tables, WAL, PRAGMA. Authoritative for any schema decision.
- **[oxc](https://oxc.rs)** AST node reference — for JS/TS extraction work.
- **[Lightning CSS docs](https://lightningcss.dev/)** — for CSS extraction work.
- **[JSON-RPC 2.0](https://www.jsonrpc.org/specification) + MCP spec** — for MCP tool / resource additions.
- **[TC39 proposals](https://github.com/tc39/proposals)** + tsgo / tsc release notes — for parser-sensitive syntax additions.
- **Existing codemap surface** (`docs/architecture.md`, `--recipes-json`, `db.ts`) — every recipe / column / engine should compose with what's already shipped.

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

- Inspiration sources catalogue: [`docs/research/non-goals-reassessment-2026-05.md § 4`](../../docs/research/non-goals-reassessment-2026-05.md#4-inspiration-sources-for-plan-pr-authoring).
- Cohort positioning + differentiation axes: [`docs/research/non-goals-reassessment-2026-05.md` Header](../../docs/research/non-goals-reassessment-2026-05.md).
- Tier system rationale (this is a Tier-2 rule): [`agents-tier-system`](./agents-tier-system.md).
- File-layout convention: [`agents-first-convention`](./agents-first-convention.md).
