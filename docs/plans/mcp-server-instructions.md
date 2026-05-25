# MCP server instructions — plan

> **Status:** open · **Priority:** P0 · **Effort:** S (~1 week)
>
> **Motivator:** MCP clients inject server `instructions` from the `initialize` response into the agent system prompt. Codemap today exposes tools and resources but no tool-selection playbook — agents must discover `query_recipe` vs `impact` vs `context` from the pointer skill alone.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p0)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                            | Source                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| L.1 | Instructions are **operational guidance only** — which tool when, common chains, anti-patterns. Full schema/recipe catalog stays on `codemap://skill` / `codemap://rule` resources. | [Moat A](../roadmap.md#moats-load-bearing)                         |
| L.2 | Content lives in **`templates/agent-content/`** and is assembled by `agent-content.ts` — same pointer/version discipline as skill/rule.                                             | [agents.md](../agents.md)                                          |
| L.3 | No NL routing or embedded intent classification in instructions.                                                                                                                    | [Floor — No LLM in the box](../roadmap.md#floors-v1-product-shape) |

---

## Implementation steps

1. **Author `templates/agent-content/mcp-instructions.md`** (~60 lines):
   - Session start → `context` + fetch `codemap://rule`
   - Symbol lookup → `show` / `query_recipe find-symbol-by-kind`
   - Blast radius → `impact` or `query_recipe fan-in`
   - CI findings → `query_recipe` + `--format sarif` via CLI; MCP `query_recipe` with JSON
   - Every MCP convenience tool must name its recipe twin (when wrappers ship)
2. **Wire into `createMcpServer()`** — pass `instructions` field on `McpServer` init (`src/application/mcp-server.ts`).
3. **Expose via pointer protocol** — optional `codemap://mcp-instructions` resource or section in live rule.
4. **Tests** — snapshot instructions length; assert no stale recipe ids (grep against `templates/recipes/`).

---

## Acceptance

- [ ] `codemap mcp` startup includes instructions in MCP initialize handshake
- [ ] Instructions cite only shipped recipe ids and tool names
- [ ] Documented in [agents.md](../agents.md) § MCP

---

## Dependencies

None. Ships first in the agent-ops sequence.
