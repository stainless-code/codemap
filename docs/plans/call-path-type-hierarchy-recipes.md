# Call path and type hierarchy recipes — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~1–2 weeks)
>
> **Motivator:** Shortest-path and type-ancestor queries are common agent tasks. `impact` walks radius but doesn't find minimal paths. `type_members` exists but no bundled recipe for extends/implements chains.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p2) · overlaps [mcp-trace-explore-tools](./mcp-trace-explore-tools.md) (ship recipes there first for call-path)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                     | Source         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| L.1 | **Recipes only** in this plan — MCP wrappers live in [mcp-trace-explore-tools](./mcp-trace-explore-tools.md).                                | Split concerns |
| L.2 | Call path uses **recursive CTE** on `calls` table; optional `via=dependencies` mode.                                                         | Moat A         |
| L.3 | Type hierarchy uses **`type_members`** + class/interface `symbols` relationships where extracted; document gaps for incomplete extends data. | Honest limits  |
| L.4 | No new library export required for v1 — optional `findCallPath()` in `api.ts` later.                                                         | YAGNI          |

---

## Recipe specs

### `call-path` (may ship in P1 trace plan)

- Params: `from_name`, `to_name`, `max_depth`, `via`
- Output: ordered hops

### `type-ancestors`

- Params: `symbol_name`, `kind` (class|interface), `max_depth`
- SQL: walk `type_members` / parent_name / extends relationships available in schema
- Output: ancestor symbol rows

### `type-descendants`

- Inverse of ancestors for interface implementation queries

---

## Implementation steps

1. Audit schema for extends/implements facts — gap list in plan PR if parser additions needed
2. Implement `type-ancestors.sql` + golden queries
3. Implement `type-descendants.sql` if substrate supports
4. If `call-path` not already shipped, add here
5. Document SQL patterns in skill; link from MCP instructions

---

## Acceptance

- [ ] `type-ancestors` returns expected chain on fixture with extends
- [ ] Documented limitations when extends not extracted
- [ ] Golden-query CI covers new recipes

---

## Dependencies

- [mcp-trace-explore-tools](./mcp-trace-explore-tools.md) for `call-path` MCP wrapper
- [callback-dispatch-synthesis](./callback-dispatch-synthesis.md) improves call-path completeness
