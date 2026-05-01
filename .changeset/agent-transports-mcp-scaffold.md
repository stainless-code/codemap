---
"@stainless-code/codemap": minor
---

feat(mcp): `codemap mcp` — Model Context Protocol server (agent-transports v1)

Adds the `codemap mcp` top-level command — boots an MCP server over
stdio so agent hosts (Claude Code, Cursor, Codex, generic MCP clients)
call codemap as JSON-RPC tools instead of shelling out per query.
Eliminates the bash round-trip on every agent invocation.

Surface (one tool per CLI verb plus `query_batch`, all snake_case):

- `query`, `query_batch`, `query_recipe`, `audit`, `save_baseline`,
  `list_baselines`, `drop_baseline`, `context`, `validate`
- Resources: `codemap://recipes`, `codemap://recipes/{id}`,
  `codemap://schema`, `codemap://skill` (lazy-cached)

`query_batch` is MCP-only — N statements in one round-trip with
batch-wide-defaults + per-statement-overrides (items are
`string | {sql, summary?, changed_since?, group_by?}`). Per-statement
errors are isolated. `save_baseline` ships as one polymorphic tool
(`{name, sql? | recipe?}` with runtime exclusivity check) mirroring
the CLI's single `--save-baseline=<name>` verb.

Output shape is verbatim from each tool's CLI counterpart's `--json`
envelope (no re-mapping). Bootstrap once at server boot; tool
handlers reuse existing engine entry-points (`executeQuery`,
`runAudit`, etc.) — no duplicate business logic.

New dep: `@modelcontextprotocol/sdk`.

HTTP API (`codemap serve`) stays in roadmap backlog; design points
(tool taxonomy + output shape) are reserved in `docs/architecture.md
§ MCP wiring` so HTTP inherits them when a concrete consumer asks.
