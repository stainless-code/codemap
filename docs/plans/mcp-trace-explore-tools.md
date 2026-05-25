# MCP trace & explore tools — plan

> **Status:** shipped · **Priority:** P1 · **Effort:** M (~2 weeks)
>
> **Motivator:** Agents often need call-path and multi-symbol survey answers in one round-trip. Codemap has `impact` (radius walk) and `snippet` but no shortest-path or budget-capped multi-file survey. MCP wrappers must not erode Moat A — every wrapper ships with a recipe twin.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1) · related [call-path-type-hierarchy-recipes](./call-path-type-hierarchy-recipes.md)
>
> **Shipped:** recipes [#131](https://github.com/stainless-code/codemap/pull/131); MCP tools [#134](https://github.com/stainless-code/codemap/pull/134)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                 | Source                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| L.1 | **Recipe twins required** before MCP tools: `call-path`, `symbol-neighborhood` (bundled SQL).                                            | [Moat A](../roadmap.md#moats-load-bearing)                         |
| L.2 | MCP tools **`trace`**, **`explore`**, **`node`** are thin composers over recipes + `snippet` + existing engines — not opaque graph APIs. | Moat A                                                             |
| L.3 | **Output budgets** — cap snippet `source` chars (default 15k) + explore row cap (500); `truncated: true` with `truncation` detail.       | Agent context economics                                            |
| L.4 | No NL task parsing — `trace` takes `from` / `to` symbol names; `explore` takes symbol name list.                                         | [Floor — No LLM in the box](../roadmap.md#floors-v1-product-shape) |

---

## Recipe specs (shipped #131)

### `call-path`

- Params: `from`, `to`, optional `max_depth`, `via` (`calls` | `dependencies` | `all`)
- SQL: recursive CTE on `calls` (+ optional `dependencies` UNION)
- Output: ordered path rows `{file_path, caller_name, callee_name, line_start}`

### `symbol-neighborhood`

- Params: `name`, `depth` (default 1), optional `kind`
- SQL: UNION callers/callees from `calls` + `dependencies` fan-in/out
- Output: symbol rows suitable for `snippet` batch

---

## MCP tool specs (shipped #134)

| Tool      | Composes                                                                          |
| --------- | --------------------------------------------------------------------------------- |
| `trace`   | `query_recipe call-path` + cross-file `snippet` for hop symbols                   |
| `explore` | `query_recipe symbol-neighborhood` (deduped multi-name) + snippet budget          |
| `node`    | `show` + scoped one-hop `symbol-neighborhood` + optional center+neighbor snippets |

Register in `mcp-server.ts` + `http-server.ts`; document chains in [mcp-instructions](../templates/agent-content/mcp-instructions.md).

---

## Acceptance

- [x] `codemap query --recipe call-path --params from=foo,to=bar` works ([#131](https://github.com/stainless-code/codemap/pull/131))
- [x] MCP/HTTP `trace` returns path + snippets, respects budget ([#134](https://github.com/stainless-code/codemap/pull/134))
- [x] Instructions document recipe-first fallback ([#134](https://github.com/stainless-code/codemap/pull/134))

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
- [call-path-type-hierarchy-recipes](./call-path-type-hierarchy-recipes.md) may extend CTE patterns later
