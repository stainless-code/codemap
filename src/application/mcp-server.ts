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
import { assembleMcpInstructions } from "./agent-content";
import {
  isMcpToolEnabled,
  logMcpToolAllowlist,
  resolveMcpToolAllowlist,
} from "./mcp-tool-allowlist";
import type { McpToolName } from "./mcp-tool-allowlist";
import { listQueryRecipeCatalog } from "./query-recipes";
import { readResource } from "./resource-handlers";
import type { ResourcePayload } from "./resource-handlers";
import {
  affectedArgsSchema,
  applyArgsSchema,
  auditArgsSchema,
  contextArgsSchema,
  dropBaselineArgsSchema,
  handleApply,
  handleAudit,
  handleAffected,
  handleContext,
  handleDropBaseline,
  handleImpact,
  handleListBaselines,
  handleQuery,
  handleQueryBatch,
  handleQueryRecipe,
  handleSaveBaseline,
  handleShow,
  handleSnippet,
  handleValidate,
  impactArgsSchema,
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
  resolveRecipesWatchPrefix,
  runWatchLoop,
} from "./watcher";

/**
 * MCP server engine — owns the tool / resource registry. CLI shell
 * (`src/cli/cmd-mcp.ts`) handles argv + lifecycle only; this module is
 * the thin wrapper around `@modelcontextprotocol/sdk` that registers
 * one tool per CLI verb (plus MCP-only `query_batch`) and MCP resources
 * (static + templates). Tool bodies are pure handlers in
 * `application/tool-handlers.ts` — same handlers `codemap serve` (HTTP)
 * dispatches. See [`docs/architecture.md` § MCP wiring].
 */

interface ServerOpts {
  version: string;
  root: string;
  configFile?: string | undefined;
  stateDir?: string | undefined;
  /** Test hook — defaults to `process.env`. */
  env?: NodeJS.ProcessEnv | undefined;
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
 * `isError` envelope. JSON payloads stringify; formatted text payloads pass
 * through verbatim (already strings).
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
  const allowlistResolved = resolveMcpToolAllowlist(opts.env ?? process.env);
  const server = new McpServer(
    {
      name: "codemap",
      version: opts.version,
    },
    {
      instructions: assembleMcpInstructions(),
    },
  );

  const registered: McpToolName[] = [];
  const maybeRegister = (name: McpToolName, register: () => void): void => {
    if (!isMcpToolEnabled(name, allowlistResolved.allowlist)) return;
    register();
    registered.push(name);
  };

  maybeRegister("query", () => registerQueryTool(server, opts));
  maybeRegister("query_batch", () => registerQueryBatchTool(server, opts));
  maybeRegister("query_recipe", () => registerQueryRecipeTool(server, opts));
  maybeRegister("audit", () => registerAuditTool(server));
  maybeRegister("context", () => registerContextTool(server));
  maybeRegister("validate", () => registerValidateTool(server));
  maybeRegister("save_baseline", () => registerSaveBaselineTool(server, opts));
  maybeRegister("list_baselines", () => registerListBaselinesTool(server));
  maybeRegister("drop_baseline", () => registerDropBaselineTool(server));
  maybeRegister("show", () => registerShowTool(server, opts));
  maybeRegister("snippet", () => registerSnippetTool(server, opts));
  maybeRegister("impact", () => registerImpactTool(server));
  maybeRegister("affected", () => registerAffectedTool(server, opts));
  maybeRegister("apply", () => registerApplyTool(server, opts));
  registerResources(server);
  logMcpToolAllowlist(allowlistResolved, registered);

  return server;
}

function registerQueryTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query",
    {
      description:
        'Run one read-only SQL statement against .codemap.db. Returns the JSON envelope `codemap query --json` would print: row array by default, {count} under `summary`, {group_by, groups} under `group_by`. Pass `format: "sarif"` / `"annotations"` / `"mermaid"` / `"diff"` / `"diff-json"` to receive a formatted payload (incompatible with `summary` / `group_by`). Mermaid requires `{from, to, label?, kind?}` rows; diff requires `{file_path, line_start, before_pattern, after_pattern}` rows.',
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
        'Run a bundled SQL recipe by id. Output rows carry per-row `actions` hints (recipe-only — `query` never adds them). Parametrised recipes accept `params: {key: value}` validated against recipe frontmatter. Compose with `summary` / `changed_since` / `group_by` exactly like `query`. Pass `format: "sarif"` / `"annotations"` / `"mermaid"` / `"diff"` / `"diff-json"` to receive a formatted payload (incompatible with `summary` / `group_by`); SARIF rule id derives from the recipe id (`codemap.<recipe>`). List available recipes via the `codemap://recipes` resource.',
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
        "Structural-drift audit. Composes per-delta snapshots (files / dependencies / deprecated) into a {head, deltas} envelope. Two **primary** snapshot sources are mutually exclusive: (1) `base: <ref>` — materialises a git committish (origin/main, HEAD~5, sha, tag) via `git archive | tar -x` to a sha-keyed cache under `.codemap/audit-cache/` (plain tree, no `.git` artifact — `git clean -xdf` and `rm -rf` both sweep it), reindexes into a temp DB, diffs against current. Cache hit on second run against same sha is sub-100ms. Requires a git repository — non-git projects get `{error: 'codemap audit: --base requires a git repository'}`. (2) `baseline_prefix` — auto-resolves <prefix>-{files,dependencies,deprecated} from `query_baselines`. Plus optional **per-delta overrides** via `baselines: {<deltaKey>: <name>}` that compose with either primary source. `summary: true` collapses each delta to {added: N, removed: N}. `no_index` controls the head-side incremental-index prelude (default re-indexes; watch-active default is no-op since the watcher keeps the index fresh; pass `no_index: false` to force).",
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

function registerAffectedTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "affected",
    {
      description:
        "List test files transitively impacted by changed source files (reverse BFS on `dependencies`). Same preprocessor as `codemap affected` → `affected-tests` recipe. Args: paths (explicit project-relative paths; when set, skips git — `paths: []` is explicit empty, omit paths for git discovery), changed_since (git ref when paths omitted; default HEAD; wins only when paths omitted), test_glob (SQLite GLOB; replaces default suffix globs when set), max_depth (non-negative integer BFS cap). Returns JSON array of {test_path, impact_depth, actions?} — file paths only; CI composes the runner command.",
      inputSchema: affectedArgsSchema,
    },
    (args) => wrapToolResult(handleAffected(args, opts.root)),
  );
}

function registerImpactTool(server: McpServer): void {
  server.registerTool(
    "impact",
    {
      description:
        "Walk the dependency / calls / imports graph from <target> and return the blast radius. Replaces composing `WITH RECURSIVE` queries by hand. Args: target (symbol name or file path), direction (up|down|both, default both), via (dependencies|calls|imports|all, default all — symbol targets walk calls; file targets walk dependencies+imports; mismatched explicit choices land in skipped_backends), depth (default 3, 0=unbounded but cycle-detected and limit-capped), limit (default 500), summary (returns target+summary only). Result envelope: {target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by: 'depth'|'limit'|'exhausted'}}.",
      inputSchema: impactArgsSchema,
    },
    (args) => wrapToolResult(handleImpact(args)),
  );
}

function registerApplyTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "apply",
    {
      description:
        "Apply the diff hunks a recipe describes (one per row of {file_path, line_start, before_pattern, after_pattern}) to disk. Substrate-shaped fix executor — recipe SQL is the synthesis surface, codemap executes. Args: recipe (id), params (k=v map for parametrised recipes), dry_run (preview only; phase-1 validates against current disk; no file is written), yes (required for the write path — non-TTY transports always need explicit consent; mutually exclusive with dry_run). Result envelope (same shape across modes): {mode: 'dry-run'|'apply', applied: bool, files: [{file_path, rows_applied, warnings?}], conflicts: [{file_path, line_start, before_pattern, actual_at_line, reason}], summary: {files, files_modified, rows, rows_applied, conflicts, files_with_conflicts}}. Q2 (c) all-or-nothing — any conflict aborts the whole run before any file is touched.",
      inputSchema: applyArgsSchema,
    },
    (args) => wrapToolResult(handleApply(args, opts.root)),
  );
}

/**
 * Register codemap MCP resources (static URIs + file/symbol/recipe
 * templates). Same payloads as HTTP `GET /resources/{encoded-uri}`. Payloads come from the shared
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
    "Bundled SQL recipes catalog (id, description, sql, params, optional per-row actions). Same payload as `codemap query --recipes-json`.",
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
  registerStaticResource(
    server,
    "rule",
    "codemap://rule",
    "Full text of the bundled `templates/agents/rules/codemap.md` (always-on priming for agents working in this repo).",
  );
  registerStaticResource(
    server,
    "mcp-instructions",
    "codemap://mcp-instructions",
    "MCP initialize tool-selection playbook (operational guidance only; full catalog in codemap://skill).",
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

  server.registerResource(
    "file",
    new ResourceTemplate("codemap://files/{+path}", { list: undefined }),
    {
      description:
        "Per-file roll-up: symbols, imports, exports, coverage. Encode `{path}` URI-style. Reads live (no caching).",
      mimeType: "application/json",
    },
    (uri, variables) => {
      const path = decodeURIComponent(
        typeof variables.path === "string"
          ? variables.path
          : String(variables.path),
      );
      const payload = readResource(
        `codemap://files/${encodeURIComponent(path)}`,
      );
      return readTemplateResource(uri.toString(), payload, "file");
    },
  );

  server.registerResource(
    "symbol",
    new ResourceTemplate("codemap://symbols/{name}{?in}", { list: undefined }),
    {
      description:
        "Symbol lookup by exact name. Returns {matches, disambiguation?} envelope. Optional `?in=<path-prefix>` filter (mirrors `show --in`). Reads live (no caching).",
      mimeType: "application/json",
    },
    (uri, variables) => {
      const name =
        typeof variables.name === "string"
          ? variables.name
          : String(variables.name);
      const inRaw = variables.in;
      const inPath =
        inRaw === undefined
          ? undefined
          : typeof inRaw === "string"
            ? inRaw
            : String(inRaw);
      const resourceUri =
        inPath !== undefined && inPath.length > 0
          ? `codemap://symbols/${encodeURIComponent(name)}?in=${encodeURIComponent(inPath)}`
          : `codemap://symbols/${encodeURIComponent(name)}`;
      return readTemplateResource(
        uri.toString(),
        readResource(resourceUri),
        "symbol",
      );
    },
  );
}

function readTemplateResource(
  uri: string,
  payload: ResourcePayload | undefined,
  label: string,
): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  if (payload === undefined) {
    throw new Error(`codemap: unknown ${label} resource "${uri}".`);
  }
  return {
    contents: [
      {
        uri,
        mimeType: payload.mimeType,
        text: payload.text,
      },
    ],
  };
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
  const user = await loadUserConfig(opts.root, opts.configFile, {
    stateDir: opts.stateDir,
  });
  initCodemap(
    resolveCodemapConfig(opts.root, user, { stateDir: opts.stateDir }),
  );
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
        recipesWatchPrefix: resolveRecipesWatchPrefix(getProjectRoot()),
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
