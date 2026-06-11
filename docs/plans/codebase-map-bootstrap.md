# Codebase map in bootstrap responses — plan

> **Status:** open · **Priority:** P2 (agent warm-path) · **Effort:** S–M (~3–5 days)
>
> **Motivator:** Agents call `context` at session start today but lack a compact, hash-stable routing card: which codemap CLI/MCP verbs to reach for first, and whether the structural summary changed since the last session. Roadmap marks this **partial** — `hubs`, `start_here.index_summary`, `index_freshness`, and `codemap.schema_version` already ship on `context`; **`cli_entry_hints`** and **`map_id`** do not.
>
> **Roadmap:** [§ Agent session & warm-path economics — Codebase map](../roadmap.md#agent-session--warm-path-economics)
>
> **Not in scope:** Framework entry-point substrate (`files.is_entry`) — tracked separately at [`c9-plugin-layer.md`](./c9-plugin-layer.md). “CLI entry hints” here means **codemap command/tool routing**, not app runtime entry files.

---

## Agent start here

Read **`ContextEnvelope`** and **`composeStartHere`** in [`context-engine.ts`](../../src/application/context-engine.ts) first. Do not re-implement `start_here` — add a sibling **`codebase_map`** object and **`map_id`** at the envelope root.

### Shipped today (do not rebuild)

| Surface                                | Ships                                                                                                                                                                                                            | Does not ship                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`context` tool** / `codemap context` | `codemap.cli_version`, `codemap.schema_version`, `project.*`, `recipes[]`, `index_freshness`, optional `hubs`, `sample_markers`, `start_here` (`index_summary`, intent recipe cards, `hub_leaders` + signatures) | `map_id`, `codebase_map`, `cli_entry_hints`                                                                                                     |
| **MCP `initialize`**                   | Markdown `instructions` from [`assembleMcpInstructions()`](../../src/application/agent-content.ts) (`templates/agent-content/mcp-instructions.md`)                                                               | JSON structural map; no auto-`context` call at boot ([`runMcpServer`](../../src/application/mcp-server.ts) only bootstraps DB + optional watch) |
| **Opt-out**                            | `--compact` / MCP `compact: true` drops `hubs`, `sample_markers`, `start_here` ([`context-engine.ts:297-323`](../../src/application/context-engine.ts))                                                          | No dedicated codebase-map opt-out flag                                                                                                          |

### Key touchpoints

| File                                                                                               | Role                                                                                       |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`src/application/context-engine.ts`](../../src/application/context-engine.ts)                     | `ContextEnvelope` type, `buildContextEnvelope`, `composeStartHere`, `resolveContextBudget` |
| [`src/application/index-freshness.ts`](../../src/application/index-freshness.ts)                   | `computeIndexFreshness` (already merged into envelope)                                     |
| [`src/application/tool-handlers.ts`](../../src/application/tool-handlers.ts)                       | `contextArgsSchema`, `handleContext`                                                       |
| [`src/cli/cmd-context.ts`](../../src/cli/cmd-context.ts)                                           | `--compact`, `--for`, `--include-snippets` argv                                            |
| [`src/application/mcp-server.ts`](../../src/application/mcp-server.ts)                             | `registerContextTool`, `createMcpServer` initialize `instructions`                         |
| [`src/application/agent-content.ts`](../../src/application/agent-content.ts)                       | `assembleMcpInstructions` (Slice 2 hook)                                                   |
| [`src/cli/aliases.ts`](../../src/cli/aliases.ts)                                                   | `OUTCOME_ALIASES` — five outcome-shaped CLI aliases                                        |
| [`src/application/mcp-tool-allowlist.ts`](../../src/application/mcp-tool-allowlist.ts)             | `MCP_TOOL_NAMES` (21 tools)                                                                |
| [`src/hash.ts`](../../src/hash.ts)                                                                 | `hashContent` (SHA-256) for `map_id`                                                       |
| [`src/application/context-engine.test.ts`](../../src/application/context-engine.test.ts)           | Envelope + `composeStartHere` tests                                                        |
| [`src/application/mcp-server.test.ts`](../../src/application/mcp-server.test.ts)                   | MCP `context` + initialize instructions                                                    |
| [`templates/agent-content/mcp-instructions.md`](../../templates/agent-content/mcp-instructions.md) | Session-start playbook (Slice 2 cross-ref)                                                 |

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| L.1 | Add **`codebase_map`** on `ContextEnvelope` — sibling to `start_here`, not a replacement.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Preserve shipped `start_here` consumers                 |
| L.2 | **`map_id`** = first **16** hex chars of `hashContent(JSON.stringify(canonical))` where `canonical` uses **sorted** `hub_paths: string[]`, `index_summary` object, `schema_version`, `file_count`, `last_indexed_commit` (from existing envelope fields). Same inputs → same id across transports.                                                                                                                                                                                                                                       | [`hash.ts`](../../src/hash.ts); stable agent cache key  |
| L.3 | **`cli_entry_hints`** = structured static routing rows sourced from code constants — **not** inferred from indexed repo files. Minimum rows: (a) five [`OUTCOME_ALIASES`](../../src/cli/aliases.ts) (`dead-code` → `untested-and-dead`, …); (b) session-start MCP tools: `context`, `show`, `query_recipe`, `trace`, `explore`, `node`, `validate` (matches [`mcp-instructions.md` Session start](../../templates/agent-content/mcp-instructions.md)). Shape: `{ surface: "cli" \| "mcp", id: string, maps_to: string, note?: string }`. | Roadmap “CLI entry hints”; distinct from C.9 `is_entry` |
| L.4 | **Opt-out:** new `--no-codebase-map` CLI flag + MCP/HTTP `include_codebase_map?: boolean` (default **true** when not `compact`). When `compact: true`, omit `codebase_map` and `map_id` regardless of flag.                                                                                                                                                                                                                                                                                                                              | Roadmap “opt-out via flag”; keep `compact` semantics    |
| L.5 | **No `SCHEMA_VERSION` bump** — JSON-only envelope fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Moat B discipline; no DDL                               |
| L.6 | **MCP initialize Slice 2 (optional):** append a short auto-generated block to `assembleMcpInstructions()` output: `map_id` + top 3 `hub_paths` + link to call `context` for full map. MCP SDK exposes no structured initialize JSON beyond `instructions` ([`createMcpServer`](../../src/application/mcp-server.ts:157-164)).                                                                                                                                                                                                            | Factual transport constraint                            |

---

## Target envelope shape (Slice 1)

```typescript
// Added to ContextEnvelope in context-engine.ts
map_id?: string; // omitted when compact / --no-codebase-map
codebase_map?: {
  hub_paths: string[]; // from start_here.hub_leaders[].file_path (same budget cap)
  cli_entry_hints: {
    surface: "cli" | "mcp";
    id: string;
    maps_to: string;
    note?: string;
  }[];
};
```

`map_id` is computed **after** `hub_paths` are known so agents can compare ids without re-fetching full `start_here`.

---

## Implementation slices

| Slice | Scope                                                                                                                                                                                               | Ship gate                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **1** | Types + `buildCodebaseMap()` + `computeMapId()` in `context-engine.ts`; wire `handleContext` / `cmd-context`; tests in `context-engine.test.ts` + `tool-handlers.test.ts`                           | Tracer bullet — land first        |
| **2** | MCP initialize instructions append (requires DB at `assembleMcpInstructions` time **or** lazy placeholder + “call `context`”) — pick one in PR; update `mcp-instructions.md` + `mcp-server.test.ts` | Only after Slice 1 green          |
| **3** | Docs: [`architecture.md` § Context wiring](../architecture.md), [`agents.md`](../agents.md) bootstrap table; roadmap item → check `[x]` + delete this plan when closed                              | Same PR as Slice 1–2 or follow-up |

### Tracer bullet (Slice 1)

1. Add `buildCodebaseMap({ hubLeaders, compact, include })` returning `undefined` when `compact || !include`.
2. Add `computeMapId(canonical)` using `hashContent`.
3. Extend `contextArgsSchema` + `parseContextRest` with opt-out flag.
4. Test: stable `map_id` for fixed fixture DB; opt-out omits fields; `compact` omits fields.

### Out of scope

- `files.is_entry` / framework route substrate ([`c9-plugin-layer.md`](./c9-plugin-layer.md), [`framework-route-extraction.md`](./framework-route-extraction.md))
- Auto-invoking `context` inside `runMcpServer` (extra index work on every MCP boot)
- New MCP resource `codemap://map` (defer unless a consumer requests it)
- Verdict / pass-fail on map freshness (Moat A)

---

## Acceptance

- [ ] `codemap context --json` includes `map_id` + `codebase_map.cli_entry_hints` with all five outcome aliases and seven session-start MCP tools (L.3)
- [ ] Re-running `context` on unchanged index returns identical `map_id`
- [ ] `codemap context --compact` and `--no-codebase-map` omit `map_id` and `codebase_map`
- [ ] MCP `context` JSON matches CLI envelope (parity via `handleContext`)
- [ ] `bun test src/application/context-engine.test.ts src/application/tool-handlers.test.ts src/application/mcp-server.test.ts`

---

## Verification

```bash
bun test src/application/context-engine.test.ts src/application/tool-handlers.test.ts
bun src/index.ts context --json | jq '.map_id, .codebase_map.cli_entry_hints | length'
bun src/index.ts context --no-codebase-map --json | jq 'has("map_id")'   # expect false after implementation
bun src/index.ts context --compact --json | jq 'has("codebase_map")'      # expect false after implementation
```

---

## Dependencies

- Shipped: `start_here`, `index_freshness`, `OUTCOME_ALIASES`, 21-tool MCP allowlist
- Independent of: C.9 plugin layer, FTS default-on, tiered lookup fast paths
