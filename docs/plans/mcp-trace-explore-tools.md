# MCP trace & explore tools — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~2 weeks)
>
> **Motivator:** Agents often need call-path and multi-symbol survey answers in one round-trip. Codemap has `impact` (radius walk) and `snippet` but no shortest-path or budget-capped multi-file survey. MCP wrappers must not erode Moat A — every wrapper ships with a recipe twin.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1) · related [call-path-type-hierarchy-recipes](./call-path-type-hierarchy-recipes.md)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                 | Source                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| L.1 | **Recipe twins required** before MCP tools: `call-path`, `symbol-neighborhood` (bundled SQL).                                            | [Moat A](../roadmap.md#moats-load-bearing)                         |
| L.2 | MCP tools **`trace`**, **`explore`**, **`node`** are thin composers over recipes + `snippet` + existing engines — not opaque graph APIs. | Moat A                                                             |
| L.3 | **Output budgets** — cap total response chars (e.g. 15k); truncate with explicit `truncated: true` in JSON.                              | Agent context economics                                            |
| L.4 | No NL task parsing — `trace` takes `from` / `to` symbol names; `explore` takes symbol list or recipe result rows.                        | [Floor — No LLM in the box](../roadmap.md#floors-v1-product-shape) |

---

## Recipe specs (ship first)

### `call-path`

- Params: `from`, `to`, optional `max_depth`, `via` (`calls` | `dependencies` | `all`)
- SQL: recursive CTE on `calls` (+ optional `dependencies` UNION)
- Output: ordered path rows `{file_path, caller_name, callee_name, line_start}`

### `symbol-neighborhood`

- Params: `name`, `depth` (default 1), optional `kind`
- SQL: UNION callers/callees from `calls` + `dependencies` fan-in/out
- Output: symbol rows suitable for `snippet` batch

---

## MCP tool specs (ship second)

| Tool      | Composes                                                                     |
| --------- | ---------------------------------------------------------------------------- |
| `trace`   | `query_recipe call-path` + `snippet` for each hop                            |
| `explore` | `query_recipe symbol-neighborhood` (multi-name) + `snippet` with char budget |
| `node`    | `show` + one-hop `symbol-neighborhood` + optional inline snippets            |

Register in `mcp-server.ts`; document chains in [mcp-server-instructions](./mcp-server-instructions.md).

---

## Implementation steps

1. Add `templates/recipes/call-path.sql` + `.md` frontmatter
2. Add `templates/recipes/symbol-neighborhood.sql` + `.md`
3. Golden-query tests for both recipes
4. Implement MCP handlers in `tool-handlers.ts` (or dedicated module)
5. Output budget helper shared by explore/trace
6. Update agent-content skill with SQL equivalents

---

## Acceptance

- [ ] `codemap query --recipe call-path --params from=foo,to=bar` works
- [ ] MCP `trace` returns same path + snippets, respects budget
- [ ] Instructions document recipe-first fallback

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) should land first or in same PR
- [call-path-type-hierarchy-recipes](./call-path-type-hierarchy-recipes.md) may extend CTE patterns later
