import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadUserConfig, resolveCodemapConfig } from "../config";
import { getFilesChangedSince } from "../git-changed";
import { GROUP_BY_MODES } from "../group-by";
import type { GroupByMode } from "../group-by";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { executeQuery, executeQueryBatch } from "./query-engine";
import type { BatchStatementResolved } from "./query-engine";

/**
 * MCP server engine — owns the tool/resource registry. The CLI shell
 * (`src/cli/cmd-mcp.ts`) only handles argv parsing and lifecycle; this
 * module is the thin wrapper around `@modelcontextprotocol/sdk` that
 * registers codemap's tools (one per CLI verb — see plan § 3) and
 * resources (see plan § 7).
 *
 * Ships incrementally per plan § 11. Tracer 2 wires `query` + `query_batch`;
 * subsequent tracers add `query_recipe`, `audit`, baseline tools, and
 * resources.
 */

interface ServerOpts {
  version: string;
  root: string;
  configFile?: string | undefined;
}

const groupByEnum = z.enum(
  GROUP_BY_MODES as unknown as readonly [GroupByMode, ...GroupByMode[]],
);

// Per-statement schema for query_batch — matches the `oneOf` polymorphism
// in plan § 5: items are either a bare SQL string or an object that
// overrides batch-wide flags on a per-key basis.
const batchItemSchema = z.union([
  z.string().min(1, "sql must be a non-empty string"),
  z.object({
    sql: z.string().min(1, "sql must be a non-empty string"),
    summary: z.boolean().optional(),
    changed_since: z.string().optional(),
    group_by: groupByEnum.optional(),
  }),
]);

/**
 * Wraps a tool handler so any thrown error becomes a structured
 * `{"error":"<message>"}` payload (matching the CLI's `--json` error
 * shape — plan § 4 uniformity). Without this, an unhandled throw
 * surfaces as a JSON-RPC error which loses the CLI-shape contract.
 */
function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function jsonError(message: string) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message }) },
    ],
  };
}

/**
 * Resolve `changed_since: <ref>` to a Set of project-relative paths.
 * Memoised per (root, ref) pair across batch items so a batch with N
 * items sharing the same ref does one git invocation instead of N.
 */
function makeChangedFilesResolver(
  root: string,
): (ref: string | undefined) => Set<string> | undefined | { error: string } {
  const cache = new Map<string, Set<string>>();
  return (ref) => {
    if (ref === undefined) return undefined;
    const cached = cache.get(ref);
    if (cached) return cached;
    const result = getFilesChangedSince(ref, root);
    if (!result.ok) return { error: result.error };
    cache.set(ref, result.files);
    return result.files;
  };
}

export function createMcpServer(opts: ServerOpts): McpServer {
  const server = new McpServer({
    name: "codemap",
    version: opts.version,
  });

  registerQueryTool(server, opts);
  registerQueryBatchTool(server, opts);

  return server;
}

function registerQueryTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query",
    {
      description:
        "Run one read-only SQL statement against .codemap.db. Returns the JSON envelope `codemap query --json` would print: row array by default, {count} under `summary`, {group_by, groups} under `group_by`. Use `query_batch` for N statements in one round-trip.",
      inputSchema: {
        sql: z.string().min(1, "sql must be a non-empty string"),
        summary: z.boolean().optional(),
        changed_since: z.string().optional(),
        group_by: groupByEnum.optional(),
      },
    },
    (args) => {
      try {
        const resolveChanged = makeChangedFilesResolver(opts.root);
        const changed = resolveChanged(args.changed_since);
        if (changed && typeof changed === "object" && "error" in changed) {
          return jsonError(changed.error);
        }
        const payload = executeQuery({
          sql: args.sql,
          summary: args.summary,
          changedFiles: changed as Set<string> | undefined,
          groupBy: args.group_by,
          root: opts.root,
        });
        if (
          payload !== null &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          "error" in payload
        ) {
          return jsonError(payload.error as string);
        }
        return jsonResult(payload);
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerQueryBatchTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query_batch",
    {
      description:
        "Run N read-only SQL statements in one round-trip. Each item is either a bare SQL string (inherits batch-wide flags) or an object {sql, summary?, changed_since?, group_by?} overriding batch-wide flags per-key. Returns an N-element array; per-element shape mirrors single `query`'s output for that statement's effective flag set.",
      inputSchema: {
        statements: z.array(batchItemSchema).min(1),
        summary: z.boolean().optional(),
        changed_since: z.string().optional(),
        group_by: groupByEnum.optional(),
      },
    },
    (args) => {
      try {
        const resolveChanged = makeChangedFilesResolver(opts.root);
        const resolved: BatchStatementResolved[] = [];
        for (const item of args.statements) {
          const merged = mergeBatchItem(item, args);
          const changed = resolveChanged(merged.changed_since);
          if (changed && typeof changed === "object" && "error" in changed) {
            return jsonError(changed.error);
          }
          resolved.push({
            sql: merged.sql,
            summary: merged.summary,
            changedFiles: changed as Set<string> | undefined,
            groupBy: merged.group_by,
          });
        }
        const results = executeQueryBatch({
          statements: resolved,
          root: opts.root,
        });
        return jsonResult(results);
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

interface MergedBatchItem {
  sql: string;
  summary: boolean | undefined;
  changed_since: string | undefined;
  group_by: GroupByMode | undefined;
}

function mergeBatchItem(
  item: z.infer<typeof batchItemSchema>,
  defaults: {
    summary?: boolean | undefined;
    changed_since?: string | undefined;
    group_by?: GroupByMode | undefined;
  },
): MergedBatchItem {
  if (typeof item === "string") {
    return {
      sql: item,
      summary: defaults.summary,
      changed_since: defaults.changed_since,
      group_by: defaults.group_by,
    };
  }
  // Object form: per-statement keys override batch-wide defaults.
  // Missing keys inherit; explicit `undefined` is treated as "inherit"
  // since Zod `.optional()` produces missing-key indistinguishable
  // from explicit-undefined here.
  return {
    sql: item.sql,
    summary: item.summary ?? defaults.summary,
    changed_since: item.changed_since ?? defaults.changed_since,
    group_by: item.group_by ?? defaults.group_by,
  };
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
