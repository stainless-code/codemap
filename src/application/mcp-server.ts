import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import {
  getExcludeDirNames,
  getProjectRoot,
  getTsconfigPath,
  initCodemap,
} from "../runtime";
import { listQueryRecipeCatalog } from "./query-recipes";
import { readResource } from "./resource-handlers";
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
import {
  createPrimeIndex,
  createReindexOnChange,
  DEFAULT_DEBOUNCE_MS,
  runWatchLoop,
} from "./watcher";

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
  /**
   * If true, boot a co-process file watcher (chokidar via
   * `runWatchLoop`) so the server's tools always read live data without
   * a per-request reindex prelude. Drains pending events on shutdown.
   * See [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage).
   */
  watch?: boolean;
  /** Coalesce burst events into one reindex after `debounceMs` of quiet. Only meaningful when `watch: true`. */
  debounceMs?: number;
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
        "Structural-drift audit. Composes per-delta baselines (files / dependencies / deprecated) into a {head, deltas} envelope. Pass `baseline_prefix` to auto-resolve <prefix>-{files,dependencies,deprecated} from query_baselines, OR `baselines: {<deltaKey>: <name>}` for explicit per-delta overrides (composes with prefix — both shapes work the same in watch mode). `summary: true` collapses each delta to {added: N, removed: N}. `no_index` controls the auto-incremental-index prelude that runs before the diff: default `true`-equivalent without watch (re-indexes first so head reflects current source), default `false`-equivalent with `--watch` active (the watcher already kept the index fresh — prelude becomes a no-op). Pass `no_index: false` explicitly to force a re-index even when watch is active (escape hatch for 'force a re-index right now').",
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
 * Register codemap's four MCP resources. Payloads come from the shared
 * `application/resource-handlers.ts` module — same lazy-cache used by the
 * HTTP transport (`GET /resources/{uri}` in `http-server.ts`). Resources
 * are constant for the server-process lifetime so eager-vs-lazy produce
 * identical observable behavior; lazy keeps boot lean for sessions that
 * never call read_resource.
 */
function registerResources(server: McpServer): void {
  registerStaticResource(
    server,
    "recipes",
    "codemap://recipes",
    "Bundled SQL recipes catalog (id, description, sql, optional per-row actions). Same payload as `codemap query --recipes-json`.",
  );
  registerStaticResource(
    server,
    "schema",
    "codemap://schema",
    "DDL of every table in .codemap.db (queried live from sqlite_schema). Tells the agent what tables and columns exist.",
  );
  registerStaticResource(
    server,
    "skill",
    "codemap://skill",
    "Full text of the bundled `templates/agents/skills/codemap/SKILL.md`. Agents that don't preload the skill at session start can fetch it here.",
  );

  // codemap://recipes/{id} — one recipe (template form). Payload includes
  // `body` / `source` / `shadows` from the catalog entry — session-start
  // agents check `shadows` to know when a project recipe overrides the
  // documented bundled version.
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
      const payload = readResource(`codemap://recipes/${id}`);
      if (payload === undefined) {
        throw new Error(
          `codemap: unknown recipe "${id}". Read codemap://recipes for the catalog.`,
        );
      }
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: payload.mimeType,
            text: payload.text,
          },
        ],
      };
    },
  );
}

function registerStaticResource(
  server: McpServer,
  name: string,
  uri: string,
  description: string,
): void {
  server.registerResource(name, uri, { description }, () => {
    const payload = readResource(uri);
    if (payload === undefined) {
      throw new Error(`codemap: internal — resource "${uri}" not registered.`);
    }
    return {
      contents: [{ uri, mimeType: payload.mimeType, text: payload.text }],
    };
  });
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

  let stopWatch: (() => Promise<void>) | undefined;
  if (opts.watch === true) {
    // eslint-disable-next-line no-console -- intentional bootstrap log on stderr
    console.error("codemap mcp: --watch enabled, booting file watcher...");
    try {
      const handle = runWatchLoop({
        root: getProjectRoot(),
        excludeDirNames: getExcludeDirNames(),
        debounceMs: opts.debounceMs ?? DEFAULT_DEBOUNCE_MS,
        onPrime: createPrimeIndex({ quiet: false, label: "codemap mcp" }),
        onChange: createReindexOnChange({
          quiet: false,
          label: "codemap mcp",
        }),
      });
      stopWatch = handle.stop;
    } catch (err) {
      // Watcher boot threw — close the MCP transport so the agent host
      // sees the disconnect cleanly instead of a half-alive server.
      // Caught by CodeRabbit on PR #47.
      await server.close();
      throw err;
    }
  }

  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });

  if (stopWatch !== undefined) {
    try {
      await stopWatch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- intentional shutdown-error log
      console.error(`codemap mcp: watcher stop failed — ${msg}`);
    }
  }
}
