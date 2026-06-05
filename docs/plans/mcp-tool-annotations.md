# MCP tool annotation hints — plan

> **Status:** open · **Priority:** P2 · **Effort:** S (~3–5 days)
>
> **Motivator:** MCP clients use tool metadata (`readOnlyHint`, `destructiveHint`, `idempotentHint`) to gate auto-approval, sandboxing, and UI affordances. Codemap registers tools with descriptions only — write tools (`apply`, `apply_rows`, `apply_diff_input`, `save_baseline`, `drop_baseline`, `ingest_coverage`) are indistinguishable from read tools at the protocol layer.
>
> **Roadmap:** [§ Agent session & warm-path economics](../roadmap.md#agent-session--warm-path-economics)

---

## Agent start here

Smallest slice: add **`mcp-tool-annotations.ts`** map + thread into **one** `registerTool` call; snapshot-test `tools/list`; then roll through remaining tools and HTTP `GET /tools`. No handler behavior changes.

### Key touchpoints

| File                                                                                             | What to read                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`src/application/mcp-server.ts`](../../src/application/mcp-server.ts)                           | All `server.registerTool(…)` registrations                                |
| [`src/application/mcp-tool-allowlist.ts`](../../src/application/mcp-tool-allowlist.ts)           | `CODEMAP_MCP_TOOLS` subset — annotations must apply when allowlist active |
| [`src/application/tool-handlers.ts`](../../src/application/tool-handlers.ts)                     | HTTP tool catalog if separate from MCP list                               |
| [`src/application/http-server.ts`](../../src/application/http-server.ts)                         | `GET /tools` JSON shape                                                   |
| [`src/application/mcp-tool-allowlist.test.ts`](../../src/application/mcp-tool-allowlist.test.ts) | Allowlist regression patterns                                             |

### Architecture

```text
MCP_TOOL_ANNOTATIONS: Record<toolName, ToolAnnotations>
  → mcp-server registerTool({ …, annotations })
  → tools/list response (advisory hints only)
  → GET /tools parity (architecture § HTTP wiring)
```

Apply tools already gated by `--yes` / `yes: true` in handlers — annotations are client-side UX only.

### Tracer bullet (slice 1)

Map + annotations on `apply` and `query` only; one test asserting `destructiveHint` / `readOnlyHint`; expand matrix to full tool set in slice 2.

### Out of scope (v1)

Changing apply confirmation gates; runtime enforcement of hints inside handlers.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                     | Source                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| M.1 | **Annotations on `tools/list` only** — no behavior change to handlers; hints are advisory per [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#toolannotations). | MCP spec                                           |
| M.2 | **Central map in code** — `MCP_TOOL_ANNOTATIONS: Record<McpToolName, ToolAnnotations>` beside `mcp-tool-allowlist.ts`; single source for all `registerTool` calls.                                           | DRY; allowlist already names the tool set          |
| M.3 | **Conservative destructive set** — `apply`, `apply_rows`, `apply_diff_input` → `destructiveHint: true`, `readOnlyHint: false`. All query/show/trace/audit read paths → `readOnlyHint: true`.                 | Matches shipped apply confirmation gates (`--yes`) |
| M.4 | **`save_baseline` / `drop_baseline` / `ingest_coverage`** — `readOnlyHint: false` (mutate index user-data tables); not `destructiveHint` (no source-file writes).                                            | Distinct from apply                                |
| M.5 | **HTTP `/tools` catalog parity** — expose the same hint fields on `GET /tools` JSON so non-MCP consumers benefit.                                                                                            | [architecture § HTTP](../architecture.md)          |
| M.6 | **SDK capability guard** — if installed `@modelcontextprotocol/sdk` version lacks annotation fields, skip silently (no runtime error).                                                                       | Packaging compatibility                            |

---

## Annotation matrix (v1)

| Tool                                             | readOnlyHint | destructiveHint | idempotentHint | Notes                     |
| ------------------------------------------------ | ------------ | --------------- | -------------- | ------------------------- |
| `query`, `query_recipe`, `query_batch`           | true         | false           | true           |                           |
| `context`, `validate`, `show`, `snippet`         | true         | false           | true           |                           |
| `impact`, `affected`, `trace`, `explore`, `node` | true         | false           | true           |                           |
| `audit`, `list_baselines`                        | true         | false           | true           |                           |
| `save_baseline`                                  | false        | false           | true           | Rewrites one baseline row |
| `drop_baseline`                                  | false        | false           | true           |                           |
| `ingest_coverage`                                | false        | false           | false          | Replaces coverage slice   |
| `apply`, `apply_rows`, `apply_diff_input`        | false        | true            | false          | Disk writes               |

---

## Implementation steps

1. Add `mcp-tool-annotations.ts` with typed map + `getMcpToolAnnotations(name)`.
2. Thread `annotations` into each `server.registerTool(…, { description, inputSchema, annotations }, …)` in `mcp-server.ts`.
3. Extend `GET /tools` handler in `http-server.ts` to include annotation fields.
4. Unit test — snapshot `tools/list` shape (or mock server list) asserts apply tools carry `destructiveHint: true`.
5. Update `templates/agent-content/` MCP section one line: "write tools carry `destructiveHint`".
6. Optional: one sentence in [agents.md § MCP](../agents.md) for consumer-facing discoverability.

---

### Verification

```bash
bun test src/application/mcp-tool-allowlist.test.ts src/application/mcp-server.test.ts
# Snapshot tools/list — apply → destructiveHint, query → readOnlyHint
curl -s http://127.0.0.1:7878/tools   # after codemap serve --token …
```

---

## Acceptance

- [ ] MCP `tools/list` returns annotations on all registered tools
- [ ] `apply` / `apply_rows` / `apply_diff_input` have `destructiveHint: true`
- [ ] `query` / `show` / `audit` have `readOnlyHint: true`
- [ ] `GET /tools` includes same hints
- [ ] `CODEMAP_MCP_TOOLS` allowlist subset still registers annotations correctly

---

## Dependencies

- Shipped: `mcp-server.ts`, `mcp-tool-allowlist.ts`, apply confirmation gates
- Independent of other backlog items
