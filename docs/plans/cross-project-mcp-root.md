# Cross-project MCP root — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~1–2 weeks) · **Trigger-gated**
>
> **Motivator:** Some agent setups index multiple repos (monorepo + packages, microservices). A single MCP server could query another indexed tree if given an explicit root path — without restarting the server.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p2--strategic-bets)

---

## Pre-locked decisions

| #   | Decision                                                                                                                       | Source                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| L.1 | Optional **`root` argument** on MCP tools (and HTTP) — absolute or workspace-relative path.                                    | Explicit opt-in           |
| L.2 | **LRU cache** of open DB handles per root (cap e.g. 5); close oldest on eviction.                                              | Resource bound            |
| L.3 | **Path sandbox** — reject paths outside allowed list or user home without `CODEMAP_ALLOW_ANY_ROOT=1`.                          | Safety                    |
| L.4 | Default root remains server startup `opts.root` — backward compatible.                                                         | No breaking change        |
| L.5 | **One process, multiple read-only query contexts** — indexing still one active write root per process unless lock coordinates. | Align with global runtime |

---

## Implementation steps

1. **`src/application/project-cache.ts`** — `getDbForRoot(root): Database`
2. Extend tool handler schemas with optional `root?: string`
3. Validate path exists and contains `.codemap/index.db` (or run validate message)
4. Reuse same tool handlers with per-call db handle
5. Tests — two fixture roots; cache hit/eviction
6. Document in agents.md + MCP instructions

---

## Acceptance

- [ ] MCP `query` with `root` pointing at second fixture returns correct rows
- [ ] Invalid root → structured error
- [ ] Cache eviction closes DB connections

---

## Revisit trigger

Ship when a consumer runs multi-root MCP or opens an issue with concrete layout.

---

## Dependencies

- [agents.md](../agents.md) — `index.lock` is per `<state-dir>`, not a global singleton
