# Call path and type hierarchy recipes — plan

> **Status:** shipped · **Priority:** P2 · **Effort:** M (~1–2 weeks)
>
> **Motivator:** Shortest-path and type-ancestor queries are common agent tasks. `impact` walks radius but doesn't find minimal paths. `type_members` exists but no bundled recipe for extends/implements chains.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p2--strategic-bets) · `call-path` / `symbol-neighborhood` recipes + MCP tools shipped #131/#134

---

## Pre-locked decisions

| #   | Decision                                                                                                                                     | Source         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| L.1 | **Recipes only** in this plan — MCP `trace` / `explore` / `node` wrappers already shipped.                                                   | Split concerns |
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

- [x] `type-ancestors` returns expected chain on fixture with extends
- [x] Documented limitations when extends not extracted (signature parsing — see recipe `.md` bodies)
- [x] Golden-query CI covers new recipes (`type-ancestors-dog`, `type-descendants-animal`, `type-descendants-pet-class`, `type-ancestors-unknown`)

---

## Dependencies

- MCP `trace` tool + `call-path` recipe (shipped #131/#134)
- [callback-dispatch-synthesis](./callback-dispatch-synthesis.md) improves call-path completeness
