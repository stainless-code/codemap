# MCP tool allowlist — plan

> **Status:** open · **Priority:** P0 · **Effort:** S (~2 days)
>
> **Motivator:** Minimal MCP installs and eval A/B runs need to register a subset of tools (e.g. `query,context` only). Today all 14 tools always register.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p0) · supports [agent-eval-harness](./agent-eval-harness.md)

---

## Pre-locked decisions

| #   | Decision                                                                                    | Source                         |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| L.1 | Env var **`CODEMAP_MCP_TOOLS`** — comma-separated snake_case tool names; unset = all tools. | Consistent with MCP tool names |
| L.2 | **`query_batch` always optional** — include only when listed or when unset.                 | Eval ablation                  |
| L.3 | Invalid tool names → stderr warning, ignore unknown (don't fail startup).                   | Fail-soft for typos            |

---

## Implementation steps

1. **Parse env in `createMcpServer()`** before register calls
2. **Filter `register*Tool` invocations** — skip unlisted tools
3. **Log registered set** on stderr at debug level or when allowlist active
4. **Tests** — `CODEMAP_MCP_TOOLS=query,show` registers exactly two tools
5. **Docs** — README env table; [agent-eval-harness](./agent-eval-harness.md) uses allowlist for arms

---

## Acceptance

- [ ] Subset registration works
- [ ] Default behavior unchanged when env unset
- [ ] Documented in agents.md / packaging.md

---

## Dependencies

None.
