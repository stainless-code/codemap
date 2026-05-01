---
"@stainless-code/codemap": patch
---

feat(mcp): scaffold `codemap mcp` command (Tracer 1 of agent-transports)

Adds the `codemap mcp` top-level command — boots an MCP (Model Context
Protocol) server over stdio per `docs/plans/agent-transports.md`. v1
exposes one MCP tool per CLI verb; this scaffold lands the SDK wiring

- a `ping` stub tool. Real tools (`query`, `query_recipe`, `audit`,
  baseline ops, resources) land in tracers 2–7.

New dep: `@modelcontextprotocol/sdk`.
