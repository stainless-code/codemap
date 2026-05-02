import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { resolveAgentsTemplateDir } from "../agents-init";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import {
  getQueryRecipeCatalogEntry,
  listQueryRecipeCatalog,
} from "./query-recipes";
import {
  auditArgsSchema,
  contextArgsSchema,
  dropBaselineArgsSchema,
  handleAudit,
  handleContext,
  handleDropBaseline,
  handleListBaselines,
  handleQuery,
  handleQueryBatch,
  handleQueryRecipe,
  handleSaveBaseline,
  handleShow,
  handleSnippet,
  handleValidate,
  listBaselinesArgsSchema,
  queryArgsSchema,
  queryBatchArgsSchema,
  queryRecipeArgsSchema,
  saveBaselineArgsSchema,
  showArgsSchema,
  snippetArgsSchema,
  validateArgsSchema,
} from "./tool-handlers";
import type { ToolResult } from "./tool-handlers";

/**
 * MCP server engine — owns the tool / resource registry. CLI shell
 * (`src/cli/cmd-mcp.ts`) handles argv + lifecycle only; this module is
 * the thin wrapper around `@modelcontextprotocol/sdk` that registers
 * one tool per CLI verb (plus MCP-only `query_batch`) and the four
 * `codemap://` resources. Tool bodies are pure handlers in
 * `application/tool-handlers.ts` — same handlers `codemap serve` (HTTP)
 * dispatches. See [`docs/architecture.md` § MCP wiring].
 */

interface ServerOpts {
  version: string;
  root: string;
  configFile?: string | undefined;
}

/**
 * Translate the transport-agnostic `ToolResult` into MCP's `content` /
 * `isError` envelope. JSON payloads stringify; sarif/annotations text
 * payloads pass through verbatim (already strings).
 */
function wrapToolResult(r: ToolResult) {
  if (!r.ok) {
    return {
      isError: true,
      content: [
        { type: "text" as const, text: JSON.stringify({ error: r.error }) },
      ],
    };
  }
  if (r.format === "json") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r.payload) }],
    };
  }
  return { content: [{ type: "text" as const, text: r.payload }] };
}

/**
 * Build a fully-configured `McpServer` instance with every codemap tool
 * and resource registered. Doesn't connect to a transport — caller owns
 * lifecycle (production: `runMcpServer` attaches stdio; tests:
 * `InMemoryTransport.createLinkedPair()` for in-process driving).
 */
export function createMcpServer(opts: ServerOpts): McpServer {
  const server = new McpServer({
    name: "codemap",
    version: opts.version,
  });

  registerQueryTool(server, opts);
  registerQueryBatchTool(server, opts);
  registerQueryRecipeTool(server, opts);
  registerAuditTool(server);
  registerContextTool(server);
  registerValidateTool(server);
  registerSaveBaselineTool(server, opts);
  registerListBaselinesTool(server);
  registerDropBaselineTool(server);
  registerShowTool(server, opts);
  registerSnippetTool(server, opts);
  registerResources(server);

  return server;
}

function registerQueryTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query",
    {
      description:
        'Run one read-only SQL statement against .codemap.db. Returns the JSON envelope `codemap query --json` would print: row array by default, {count} under `summary`, {group_by, groups} under `group_by`. Pass `format: "sarif"` or `"annotations"` to receive a formatted text payload (incompatible with `summary` / `group_by`). Use `query_batch` for N statements in one round-trip.',
      inputSchema: queryArgsSchema,
    },
    (args) => wrapToolResult(handleQuery(args, opts.root)),
  );
}

function registerQueryRecipeTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query_recipe",
    {
      description:
        'Run a bundled SQL recipe by id. Output rows carry per-row `actions` hints (recipe-only — `query` never adds them). Compose with `summary` / `changed_since` / `group_by` exactly like `query`. Pass `format: "sarif"` or `"annotations"` to receive a formatted text payload (incompatible with `summary` / `group_by`); SARIF rule id derives from the recipe id (`codemap.<recipe>`). List available recipes via the `codemap://recipes` resource.',
      inputSchema: queryRecipeArgsSchema,
    },
    (args) => wrapToolResult(handleQueryRecipe(args, opts.root)),
  );
}

function registerQueryBatchTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query_batch",
    {
      description:
        "Run N read-only SQL statements in one round-trip. Each item is either a bare SQL string (inherits batch-wide flags) or an object {sql, summary?, changed_since?, group_by?} overriding batch-wide flags per-key. Returns an N-element array; per-element shape mirrors single `query`'s output for that statement's effective flag set.",
      inputSchema: queryBatchArgsSchema,
    },
    (args) => wrapToolResult(handleQueryBatch(args, opts.root)),
  );
}

function registerAuditTool(server: McpServer): void {
  server.registerTool(
    "audit",
    {
      description:
        "Structural-drift audit. Composes per-delta baselines (files / dependencies / deprecated) into a {head, deltas} envelope. Pass `baseline_prefix` to auto-resolve <prefix>-{files,dependencies,deprecated} from query_baselines, OR `baselines: {<deltaKey>: <name>}` for explicit per-delta overrides (composes with prefix). `summary: true` collapses each delta to {added: N, removed: N}. `no_index: true` skips the auto-incremental-index prelude (default re-indexes first so head reflects current source).",
      inputSchema: auditArgsSchema,
    },
    async (args) => wrapToolResult(await handleAudit(args)),
  );
}

function registerContextTool(server: McpServer): void {
  server.registerTool(
    "context",
    {
      description:
        "Project bootstrap snapshot — returns the same envelope `codemap context --json` prints (project root, schema version, file/symbol counts, language breakdown, recipe catalog summary, etc.). Designed for agent session-start: one call replaces 4-5 `query` calls.",
      inputSchema: contextArgsSchema,
    },
    (args) => wrapToolResult(handleContext(args)),
  );
}

function registerValidateTool(server: McpServer): void {
  server.registerTool(
    "validate",
    {
      description:
        "Compare on-disk SHA-256 of indexed files to the indexed `files.content_hash` column. Returns rows with status ('ok' / 'changed' / 'missing'). Empty `paths` validates every indexed file. Useful for 'codemap doctor' agents that diagnose stale .codemap.db before issuing structural queries.",
      inputSchema: validateArgsSchema,
    },
    (args) => wrapToolResult(handleValidate(args)),
  );
}

function registerSaveBaselineTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "save_baseline",
    {
      description:
        "Snapshot the rows of a SQL or recipe under `name` in query_baselines. Polymorphic input: pass exactly one of `sql` (ad-hoc SELECT) or `recipe` (bundled recipe id). Mirrors `codemap query --save-baseline=<name>`'s single-verb shape; the runtime check that exactly one is set keeps the agent from accidentally saving an unintended source.",
      inputSchema: saveBaselineArgsSchema,
    },
    (args) => wrapToolResult(handleSaveBaseline(args, opts.root)),
  );
}

function registerListBaselinesTool(server: McpServer): void {
  server.registerTool(
    "list_baselines",
    {
      description:
        "List all saved baselines (no rows_json payload — use the audit tool with a baseline_prefix to compare against current). Returns the same array `codemap query --baselines --json` prints.",
      inputSchema: listBaselinesArgsSchema,
    },
    () => wrapToolResult(handleListBaselines()),
  );
}

function registerDropBaselineTool(server: McpServer): void {
  server.registerTool(
    "drop_baseline",
    {
      description:
        "Delete the named baseline. Returns {dropped: <name>} on success or {error} if the name doesn't exist.",
      inputSchema: dropBaselineArgsSchema,
    },
    (args) => wrapToolResult(handleDropBaseline(args)),
  );
}

function registerShowTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "show",
    {
      description:
        "Look up symbol(s) by exact name; returns {matches: [{name, kind, file_path, line_start, line_end, signature, ...}]} with structured `disambiguation` block when multiple matches. One-step lookup that beats composing `SELECT … FROM symbols WHERE name = ?` by hand. Use `snippet` for the actual source text; use `query` with `LIKE` for fuzzy lookup.",
      inputSchema: showArgsSchema,
    },
    (args) => wrapToolResult(handleShow(args, opts.root)),
  );
}

function registerSnippetTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "snippet",
    {
      description:
        "Same lookup as `show` but each match carries `source` (file lines from disk at line_start..line_end) plus `stale` (true when content_hash drifted since indexing — line range may have shifted; agent decides whether to act or re-index) and `missing` (true when file is gone). Per-execution shape mirrors `show`'s envelope; source/stale/missing are additive fields on each match.",
      inputSchema: snippetArgsSchema,
    },
    (args) => wrapToolResult(handleSnippet(args, opts.root)),
  );
}

/**
 * MCP resources are addressable read-only data the host can fetch ahead of
 * tool calls. Plan § 7 + grill round Q3 settled on **lazy memoisation**:
 * resources are constant for the server-process lifetime, so eager-vs-lazy
 * produce identical observable behavior — lazy keeps boot lean for sessions
 * that never call read_resource.
 */
function registerResources(server: McpServer): void {
  // codemap://recipes — full catalog (same as CLI's --recipes-json)
  let recipesCache: string | undefined;
  server.registerResource(
    "recipes",
    "codemap://recipes",
    {
      description:
        "Bundled SQL recipes catalog (id, description, sql, optional per-row actions). Same payload as `codemap query --recipes-json`.",
      mimeType: "application/json",
    },
    () => {
      if (recipesCache === undefined) {
        recipesCache = JSON.stringify(listQueryRecipeCatalog());
      }
      return {
        contents: [
          {
            uri: "codemap://recipes",
            mimeType: "application/json",
            text: recipesCache,
          },
        ],
      };
    },
  );

  // codemap://recipes/{id} — one recipe (template form). Per Tracer 4 the
  // payload includes `body` / `source` / `shadows` from the catalog entry —
  // session-start agents check `shadows` to know when a project recipe
  // overrides the documented bundled version.
  const oneRecipeCache = new Map<string, string>();
  server.registerResource(
    "recipe",
    new ResourceTemplate("codemap://recipes/{id}", {
      list: () => ({
        resources: listQueryRecipeCatalog().map((entry) => ({
          uri: `codemap://recipes/${entry.id}`,
          name: entry.id,
          description: entry.description,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      description:
        "Single recipe by id: {id, description, body?, sql, actions?, source, shadows?}. Replaces `codemap query --print-sql <id>` for agents; carries provenance fields so agents see when a project-local recipe overrides a bundled one.",
      mimeType: "application/json",
    },
    (uri, variables) => {
      const id =
        typeof variables.id === "string" ? variables.id : String(variables.id);
      const cached = oneRecipeCache.get(id);
      if (cached !== undefined) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: "application/json", text: cached },
          ],
        };
      }
      const entry = getQueryRecipeCatalogEntry(id);
      if (entry === undefined) {
        // Resources can't return structured errors the way tools do; throw so
        // the SDK surfaces a JSON-RPC error to the host.
        throw new Error(
          `codemap: unknown recipe "${id}". Read codemap://recipes for the catalog.`,
        );
      }
      const payload = JSON.stringify(entry);
      oneRecipeCache.set(id, payload);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: payload,
          },
        ],
      };
    },
  );

  // codemap://schema — DDL of every indexed table (queried live from sqlite_schema)
  let schemaCache: string | undefined;
  server.registerResource(
    "schema",
    "codemap://schema",
    {
      description:
        "DDL of every table in .codemap.db (queried live from sqlite_schema). Tells the agent what tables and columns exist.",
      mimeType: "application/json",
    },
    () => {
      if (schemaCache === undefined) {
        const db = openDb();
        try {
          const rows = db
            .query(
              "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as { name: string; sql: string | null }[];
          schemaCache = JSON.stringify(
            rows
              .filter((r) => r.sql !== null)
              .map((r) => ({
                name: r.name,
                ddl: r.sql,
              })),
          );
        } finally {
          closeDb(db, { readonly: true });
        }
      }
      return {
        contents: [
          {
            uri: "codemap://schema",
            mimeType: "application/json",
            text: schemaCache,
          },
        ],
      };
    },
  );

  // codemap://skill — bundled SKILL.md text
  let skillCache: string | undefined;
  server.registerResource(
    "skill",
    "codemap://skill",
    {
      description:
        "Full text of the bundled `templates/agents/skills/codemap/SKILL.md`. Agents that don't preload the skill at session start can fetch it here.",
      mimeType: "text/markdown",
    },
    () => {
      if (skillCache === undefined) {
        const skillPath = join(
          resolveAgentsTemplateDir(),
          "skills",
          "codemap",
          "SKILL.md",
        );
        skillCache = readFileSync(skillPath, "utf8");
      }
      return {
        contents: [
          {
            uri: "codemap://skill",
            mimeType: "text/markdown",
            text: skillCache,
          },
        ],
      };
    },
  );
}

/**
 * Bootstrap codemap once at server boot — config + resolver + DB access
 * all become module-level state. Tool handlers then call into the
 * pre-initialized stack on every request without re-bootstrapping.
 */
async function bootstrapForMcp(opts: ServerOpts): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile);
  initCodemap(resolveCodemapConfig(opts.root, user));
  configureResolver(getProjectRoot(), getTsconfigPath());
}

/**
 * Starts the MCP server over stdio (the only transport in v1; HTTP is
 * deferred to v1.x — see plan § 2). Resolves when the transport closes
 * (stdin EOF). Logs to stderr per MCP convention so stdout stays
 * dedicated to JSON-RPC framing.
 */
export async function runMcpServer(opts: ServerOpts): Promise<void> {
  await bootstrapForMcp(opts);
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
