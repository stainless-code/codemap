## Plan — `agent-transports`

> Expose codemap's structural-query surface to agents over a wire protocol. **v1 ships an MCP server**; HTTP API (`codemap serve`) is the v1.x slice. Both wrap the same logical operations (`query` / `audit` / `recipe` / `context` / `validate` / `baseline` ops); the plan settles the surface once so each transport inherits the same shape.
>
> Adopted from [`docs/roadmap.md` § Backlog](../roadmap.md#backlog) ("MCP server wrapping `query` …" + "HTTP API …"). Builds on every CLI primitive shipped to date — Tier A flags (PR #26), B.6 baselines (PR #30), B.7 visibility (PR #28), B.5 v1 audit (PR #33).

**Status:** Open — design pass; not yet implemented.
**Cross-refs:** [`docs/roadmap.md` § Non-goals](../roadmap.md#non-goals-v1) (no persistent daemon — HTTP API has to negotiate this), [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage) (each MCP / HTTP tool is a thin wrapper), [`.agents/lessons.md`](../../.agents/lessons.md) (changesets policy: pre-v1 patch unless schema-breaks).

---

## 1. Goal

Agents (Claude Code, Cursor, Codex, generic MCP / HTTP clients) call codemap's structural-query surface **without a Bash round-trip**. Today every agent invocation looks like:

```bash
$ codemap query --json "SELECT name, file_path FROM symbols WHERE name = 'X'"
```

After v1:

```jsonc
// MCP tool call (stdio + JSON-RPC)
{
  "name": "query",
  "arguments": {
    "sql": "SELECT name, file_path FROM symbols WHERE name = 'X'",
  },
}
```

The wins:

- **Tokens.** No bash framing, no shell quoting, no stdout parsing.
- **Latency.** No process spawn per call (MCP server is already running for the session).
- **Discoverability.** Tools self-describe via JSON Schema; agents don't have to read `--help`.
- **Composition.** Agents call `audit` directly; Codemap's existing CLI surface stays the source of truth.

## 2. Why MCP first, HTTP API as v1.x

| Axis                    | MCP server                                                                          | HTTP API (`codemap serve`)                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Real demand today**   | High — we use it ourselves through Cursor / Claude Code; MCP has consumer momentum. | Speculative — no concrete user has asked.                                                               |
| **Protocol surface**    | Settled (MCP spec; `@modelcontextprotocol/sdk`); JSON-RPC 2.0 over stdio.           | Codemap-shaped (REST routes, status codes, JSON shapes — design from scratch).                          |
| **Process model**       | Stdio-spawned per session by the agent host. Stays one-shot-per-session; no daemon. | Wants a long-lived process — tangles with the [persistent-daemon non-goal](../roadmap.md#non-goals-v1). |
| **Auth / security**     | Trusted parent process (the agent host). Trivial.                                   | Loopback / token / CORS — meaningful design.                                                            |
| **Implementation cost** | Lower — SDK does the JSON-RPC; just register tools.                                 | Higher — pick framework, design routes, handle binding.                                                 |

**v1 ships MCP only.** HTTP API stays in `roadmap.md § Backlog` until a concrete consumer asks; this plan reserves the design points (tool taxonomy, output shape, audit composition) so HTTP can inherit them when its time comes.

## 3. Tool taxonomy

**Decision: one MCP tool per CLI top-level operation.** Names mirror the CLI verb; `inputSchema` mirrors the CLI flag set.

| MCP tool                                                          | Wraps                                           | Notes                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `query`                                                           | `codemap query --json "<SQL>"`                  | Pure SQL execution; identical error-shape semantics.                                         |
| `query_recipe`                                                    | `codemap query --json --recipe <id>`            | Separate tool (vs `query` + recipe param) so agents see the recipe surface in tool listings. |
| `audit`                                                           | `codemap audit --json --baseline <prefix> ...`  | Composes per-delta baseline mapping (see § 6).                                               |
| `save_baseline` / `baseline` / `list_baselines` / `drop_baseline` | `codemap query --save-baseline=<name> ...` etc. | Each is a distinct verb the agent should pick deliberately.                                  |
| `context`                                                         | `codemap context --json`                        | Read-only; same JSON envelope.                                                               |
| `validate`                                                        | `codemap validate --json [<paths>]`             | Optional `paths` array.                                                                      |

**Rejected alternatives:**

- **One mega-`cli` tool with `command` + `args`.** Loses self-description; agents have to know each subcommand's flag set.
- **Grouped tools (`structural` / `baselines` / `audit`).** Too coarse — agents pick a tool by verb, not by category.

**Not exposed in v1:**

- `index` (re-index from agent). Risk: agent triggers a multi-second reindex in a tight loop. Defer until a concrete use case ("agent edited files, wants to re-query") emerges; today the codemap rule's auto-incremental-index discipline (and audit's prelude) handle the freshness story.
- `agents init` (developer-side; not an agent-runtime operation).
- `version` / `--help` (MCP exposes its own discovery; CLI help is for humans).

## 4. Output shape uniformity

**Decision: every tool returns the same shape its CLI counterpart already returns under `--json`.** No re-mapping.

- Success → the CLI's JSON output verbatim (`[...rows]` for `query`, `{base, head, deltas}` for `audit`, `{count}` / `{group_by, groups}` for `--summary`-flavoured ops, etc.).
- Error → MCP error response with the same `{"error": "..."}` body the CLI emits today, surfaced as the JSON-RPC error's `data` field.

**Why no re-mapping:**

1. The CLI's `--json` output is already the canonical surface; bundled `templates/agents/skills/codemap/SKILL.md` documents it. Re-shaping in MCP would create two surfaces to maintain.
2. Consumers reading docs / running `codemap query` directly see the same shape they get over MCP.
3. Future schema additions to the CLI envelope (e.g. `audit` v1.x verdict field) propagate to MCP automatically.

The MCP `server.tool(...)` registration just calls the existing CLI entry-point function (`runQueryCmd` / `runAuditCmd` / etc.) with stdout captured into the response body.

## 5. Per-tool surface (`inputSchema`)

JSON Schema for each tool mirrors the CLI flag set. Sketch for the three v1 keystones:

```jsonc
// query
{
  "name": "query",
  "description": "Run read-only SQL against .codemap.db. Returns row array.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sql": {"type": "string", "description": "Read-only SELECT."},
      "summary": {"type": "boolean", "default": false, "description": "Return {count: N} instead of rows."},
      "changed_since": {"type": "string", "description": "Filter rows to files changed since <ref>."},
      "group_by": {"type": "string", "enum": ["owner", "directory", "package"]}
    },
    "required": ["sql"]
  }
}

// query_recipe
{
  "name": "query_recipe",
  "description": "Run a bundled SQL recipe by id. Recipes carry per-row `actions` hints.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "recipe": {"type": "string", "description": "Recipe id (call list_recipes for catalog)."},
      "summary": {"type": "boolean", "default": false},
      "changed_since": {"type": "string"},
      "group_by": {"type": "string", "enum": ["owner", "directory", "package"]}
    },
    "required": ["recipe"]
  }
}

// audit
{
  "name": "audit",
  "description": "Structural-drift audit. Composes per-delta baselines into {head, deltas}.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "baseline_prefix": {"type": "string", "description": "Auto-resolves <prefix>-{files,dependencies,deprecated}."},
      "baselines": {
        "type": "object",
        "description": "Explicit per-delta override. Keys: files | dependencies | deprecated.",
        "properties": {
          "files": {"type": "string"},
          "dependencies": {"type": "string"},
          "deprecated": {"type": "string"}
        }
      },
      "summary": {"type": "boolean", "default": false},
      "no_index": {"type": "boolean", "default": false}
    }
  }
}
```

CLI flag → JSON property: kebab-case → snake_case (idiomatic JSON Schema; matches MCP spec examples).

## 6. Audit composition over MCP

The CLI's `--<delta>-baseline <name>` flags become a single structured `baselines: {[deltaKey]: name}` argument — same data shape as the engine's `AuditBaselineMap`. `--baseline <prefix>` stays a top-level `baseline_prefix` argument. The `resolveAuditBaselines` helper already exposed for tests in PR #33 is the layer the MCP wrapper calls — no logic duplication.

## 7. Resources

MCP resources are addressable read-only data the host can fetch ahead of tool calls. Codemap exposes:

| URI                      | Body                                                                | Purpose                                                                 |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `codemap://recipes`      | JSON array (same as `--recipes-json`)                               | Catalog discovery.                                                      |
| `codemap://recipes/{id}` | `{id, description, sql, actions?}`                                  | Single-recipe inspection (replaces `--print-sql <id>`).                 |
| `codemap://schema`       | DDL / column descriptions (lifted from `architecture.md § Schema`)  | Tells the agent what tables exist.                                      |
| `codemap://skill`        | Full text of the bundled `templates/agents/skills/codemap/SKILL.md` | Agents that don't preload the bundled skill can `read_resource` for it. |

Resources don't take input — they're constant-per-server-instance data. The server caches them at startup.

## 8. Composition with existing CLI

| CLI flag                                 | MCP equivalent                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| `--json`                                 | Always-on (MCP responses are structured). The CLI's terminal-mode renderer is dead code over MCP. |
| `--summary`                              | `summary: true` in tool args.                                                                     |
| `--changed-since <ref>`                  | `changed_since: "<ref>"` in tool args.                                                            |
| `--group-by <mode>`                      | `group_by: "<mode>"` in tool args.                                                                |
| `--baseline <prefix>` (audit)            | `baseline_prefix: "<prefix>"`.                                                                    |
| `--<delta>-baseline <name>` (audit)      | `baselines: {<deltaKey>: "<name>"}`.                                                              |
| `--no-index` (audit)                     | `no_index: true`.                                                                                 |
| `--recipe <id>`                          | `query_recipe` is a separate tool; no overload.                                                   |
| `--print-sql <id>`                       | `codemap://recipes/{id}` resource.                                                                |
| `--recipes-json`                         | `codemap://recipes` resource.                                                                     |
| `--baselines` / `--drop-baseline <name>` | `list_baselines` / `drop_baseline` tools.                                                         |
| `--save-baseline[=<name>]`               | `save_baseline` tool with `name` + (`recipe`                                                      | `sql`) inputs. |

## 9. CLI surface

```text
# v1 (ships first):
codemap mcp [--root <dir>] [--config <file>]      # spawned by the agent host over stdio

# v1.x (deferred until a concrete consumer asks):
codemap serve [--port 0] [--host 127.0.0.1] [--token <t>] [--root <dir>] [--config <file>]
```

- `codemap mcp` — the only new CLI verb in v1. Reads JSON-RPC on stdin, writes on stdout. Logs to stderr (per MCP convention).
- All existing CLI commands continue to work unchanged.
- Exit codes: `0` on clean shutdown (stdin EOF), `1` on bootstrap / DB / config errors.
- No new flags on existing commands.

## 10. Implementation deps

- **`@modelcontextprotocol/sdk`** (TypeScript) — official SDK; handles JSON-RPC framing, schema validation, transport. Single new dependency.
- Reuses every CLI entry-point function from `src/cli/cmd-*.ts` (no new business logic).
- New file: `src/cli/cmd-mcp.ts` (CLI dispatch — argv parse + spawn server) + `src/application/mcp-server.ts` (engine — tool registry, resource handlers, response composition). Mirrors the `cmd-audit.ts` ↔ `audit-engine.ts` seam.

## 11. Tracer-bullet sequence

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) and the codemap-audit precedent (~6 commits ship-end-to-end):

1. **CLI scaffold** — `cmd-mcp.ts` + `mcp-server.ts` skeletons. `codemap mcp --help` works; `runMcpCmd` boots `@modelcontextprotocol/sdk` server with one stub tool (e.g. `version` returning `{version: "..."}`). Smoke-test via `npx @modelcontextprotocol/inspector`. Commit.
2. **First tool — `query`** — wires the server to the existing `runQueryCmd` / `printQueryResult` logic; captures stdout into the MCP response body. Tests via SDK in-process. Commit.
3. **`query_recipe`** — separate tool surfaceing the recipe catalog. Composes `--summary` / `--changed-since` / `--group-by` via JSON args. Commit.
4. **`audit`** — wraps `runAuditCmd` / `runAudit`; the `baselines` arg becomes the `AuditBaselineMap` directly via `resolveAuditBaselines`. Auto-incremental-index prelude stays. Commit.
5. **Baseline tools** — `save_baseline` / `list_baselines` / `drop_baseline` round-trip via existing helpers. Commit.
6. **Resources** — `codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`. Commit.
7. **Docs + agents update** — `architecture.md § MCP wiring` paragraph, glossary entry, README CLI block, rule + skill across `.agents/` and `templates/agents/` (Rule 10), patch changeset. Commit.

Estimated total: ~1 day across ~7 commits.

## 12. Open questions (worth a `grill-me` round before code)

- **`context` and `validate` as MCP tools?** Both are CLI commands today. `context` is agent-shaped (returns the existing JSON envelope). `validate` is more dev-shaped (CI gate for stale indices). Worth surfacing both? Just `context`?
- **Should `query` accept multi-statement SQL?** Today's CLI rejects it (one statement per call). MCP could batch — but that's a real semantic shift.
- **Resource caching strategy.** Recipes are constant per server boot. Schema is constant per `SCHEMA_VERSION`. Skill text is constant per package version. Cache once at startup vs per-`read_resource` call?
- **Tool naming convention.** snake_case (matches MCP spec examples) vs kebab-case (matches CLI flags). Picked snake_case in §5; reconsider.
- **`save_baseline` argument shape.** Two sub-shapes: `{name, sql}` and `{name, recipe}`. One tool with optional fields, or two tools (`save_baseline_sql` / `save_baseline_recipe`)?

## 13. Non-goals (v1)

- **HTTP API.** Stays on `roadmap.md § Backlog`. Plan settles the tool taxonomy + output shape so HTTP inherits them.
- **Daemon mode for HTTP.** Even when HTTP ships, codemap stays one-shot per request unless a benchmark proves the spawn cost matters.
- **Tool-level auth on MCP.** The agent host is the trust boundary. If you don't trust your agent host, don't enable codemap.
- **Re-indexing from MCP.** Auto-incremental-index in audit handles the staleness story for now; explicit `index` tool deferred until concrete demand.
- **Streaming responses.** Codemap query results are point-in-time row sets; no streaming use case yet.

## 14. References

- Motivation: [`docs/roadmap.md` § Backlog](../roadmap.md#backlog) (MCP + HTTP API entries).
- MCP spec: <https://modelcontextprotocol.io>.
- Wraps every CLI primitive shipped in PRs #26 / #28 / #30 / #33.
- Audit baseline composition: see [`docs/architecture.md` § Audit wiring](../architecture.md#cli-usage) — same `AuditBaselineMap` shape over MCP.
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
