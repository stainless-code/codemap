import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveAgentsTemplateDir } from "../agents-init";
import { buildShowResult } from "../cli/cmd-show";
import { buildSnippetResult } from "../cli/cmd-snippet";
import { computeValidateRows, toProjectRelative } from "../cli/cmd-validate";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import {
  closeDb,
  deleteQueryBaseline,
  listQueryBaselines,
  openDb,
  upsertQueryBaseline,
} from "../db";
import { getFilesChangedSince } from "../git-changed";
import { GROUP_BY_MODES } from "../group-by";
import type { GroupByMode } from "../group-by";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { resolveAuditBaselines, runAudit } from "./audit-engine";
// Layer note: several modules below live under `src/cli/` because their CLI
// verb owns them today (`query-recipes`, `cmd-audit`'s baseline resolver,
// `cmd-context`'s envelope builder, `cmd-validate`'s row computer). We import
// them here as pure data / pure functions (no execution flow crosses
// cli → application). A future refactor may lift them to `src/application/`
// once a second consumer (HTTP API) needs them.
import { buildContextEnvelope } from "./context-engine";
import { getCurrentCommit } from "./index-engine";
import { executeQuery } from "./query-engine";
import {
  getQueryRecipeActions,
  getQueryRecipeCatalogEntry,
  getQueryRecipeSql,
  listQueryRecipeCatalog,
} from "./query-recipes";
import { runCodemapIndex } from "./run-index";
import { findSymbolsByName } from "./show-engine";

/**
 * MCP server engine — owns the tool / resource registry. CLI shell
 * (`src/cli/cmd-mcp.ts`) handles argv + lifecycle only; this module is
 * the thin wrapper around `@modelcontextprotocol/sdk` that registers
 * one tool per CLI verb (plus MCP-only `query_batch`) and the four
 * `codemap://` resources. See [`docs/architecture.md` § MCP wiring].
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

// Engine helpers (executeQuery / runAudit) return either a result payload OR
// `{error}` for in-band failures. Narrows that union cheaply for the tool
// handlers; centralised so the type-guard logic stays in one place.
function isEnginePayloadError(payload: unknown): payload is { error: string } {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  );
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

/**
 * Build a fully-configured `McpServer` instance with every codemap tool
 * and resource registered. Doesn't connect to a transport — caller owns
 * lifecycle (production: `runMcpServer` attaches stdio; tests:
 * `InMemoryTransport.createLinkedPair()` for in-process driving).
 *
 * `opts.root` is the indexed project root (forwarded to tool handlers
 * for `--changed-since` git lookups, `group_by package` workspace
 * discovery, etc.); `opts.version` populates MCP `Implementation.version`
 * for the `tools/list` self-description; `opts.configFile` is unused at
 * registration time but threaded through for symmetry with bootstrap.
 */
export function createMcpServer(opts: ServerOpts): McpServer {
  const server = new McpServer({
    name: "codemap",
    version: opts.version,
  });

  registerQueryTool(server, opts);
  registerQueryBatchTool(server, opts);
  registerQueryRecipeTool(server, opts);
  registerAuditTool(server, opts);
  registerContextTool(server, opts);
  registerValidateTool(server, opts);
  registerSaveBaselineTool(server, opts);
  registerListBaselinesTool(server, opts);
  registerDropBaselineTool(server, opts);
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
        if (isEnginePayloadError(payload)) return jsonError(payload.error);
        return jsonResult(payload);
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerQueryRecipeTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "query_recipe",
    {
      description:
        "Run a bundled SQL recipe by id. Output rows carry per-row `actions` hints (recipe-only — `query` never adds them). Compose with `summary` / `changed_since` / `group_by` exactly like `query`. List available recipes via the `codemap://recipes` resource.",
      inputSchema: {
        recipe: z.string().min(1, "recipe must be a non-empty string"),
        summary: z.boolean().optional(),
        changed_since: z.string().optional(),
        group_by: groupByEnum.optional(),
      },
    },
    (args) => {
      try {
        const sql = getQueryRecipeSql(args.recipe);
        if (sql === undefined) {
          return jsonError(
            `codemap: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
          );
        }
        const recipeActions = getQueryRecipeActions(args.recipe);
        const resolveChanged = makeChangedFilesResolver(opts.root);
        const changed = resolveChanged(args.changed_since);
        if (changed && typeof changed === "object" && "error" in changed) {
          return jsonError(changed.error);
        }
        const payload = executeQuery({
          sql,
          summary: args.summary,
          changedFiles: changed as Set<string> | undefined,
          groupBy: args.group_by,
          recipeActions,
          root: opts.root,
        });
        if (isEnginePayloadError(payload)) return jsonError(payload.error);
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
        // `changed_since` resolution can fail per-item (bad ref, git missing
        // for that branch, etc.). Run the resolver inline so a failure for
        // statement i lands in slot i instead of aborting the whole batch —
        // matches the per-statement isolation contract documented in
        // `executeQueryBatch` and plan § 5.
        const resolveChanged = makeChangedFilesResolver(opts.root);
        const results = args.statements.map((item) => {
          try {
            const merged = mergeBatchItem(item, args);
            const changed = resolveChanged(merged.changed_since);
            if (changed && typeof changed === "object" && "error" in changed) {
              return { error: changed.error };
            }
            return executeQuery({
              sql: merged.sql,
              summary: merged.summary,
              changedFiles: changed as Set<string> | undefined,
              groupBy: merged.group_by,
              root: opts.root,
            });
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : String(err),
            };
          }
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
  // Per-key override; undefined or missing key inherits batch-wide.
  return {
    sql: item.sql,
    summary: item.summary ?? defaults.summary,
    changed_since: item.changed_since ?? defaults.changed_since,
    group_by: item.group_by ?? defaults.group_by,
  };
}

function registerAuditTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "audit",
    {
      description:
        "Structural-drift audit. Composes per-delta baselines (files / dependencies / deprecated) into a {head, deltas} envelope. Pass `baseline_prefix` to auto-resolve <prefix>-{files,dependencies,deprecated} from query_baselines, OR `baselines: {<deltaKey>: <name>}` for explicit per-delta overrides (composes with prefix). `summary: true` collapses each delta to {added: N, removed: N}. `no_index: true` skips the auto-incremental-index prelude (default re-indexes first so head reflects current source).",
      inputSchema: {
        baseline_prefix: z.string().optional(),
        baselines: z
          .object({
            files: z.string().optional(),
            dependencies: z.string().optional(),
            deprecated: z.string().optional(),
          })
          .optional(),
        summary: z.boolean().optional(),
        no_index: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const db = openDb();
        try {
          if (!args.no_index) {
            await runCodemapIndex(db, { mode: "incremental", quiet: true });
          }
          const perDelta: Record<string, string> = {};
          if (args.baselines) {
            for (const [k, v] of Object.entries(args.baselines)) {
              if (typeof v === "string") perDelta[k] = v;
            }
          }
          const baselines = resolveAuditBaselines({
            db,
            baselinePrefix: args.baseline_prefix,
            perDelta,
          });
          const result = runAudit({ db, baselines });
          if ("error" in result) {
            return jsonError(result.error);
          }
          if (args.summary) {
            const counts: Record<
              string,
              {
                base: (typeof result.deltas)[string]["base"];
                added: number;
                removed: number;
              }
            > = {};
            for (const [key, delta] of Object.entries(result.deltas)) {
              counts[key] = {
                base: delta.base,
                added: delta.added.length,
                removed: delta.removed.length,
              };
            }
            return jsonResult({ head: result.head, deltas: counts });
          }
          return jsonResult(result);
        } finally {
          closeDb(db, { readonly: args.no_index === true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerContextTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "context",
    {
      description:
        "Project bootstrap snapshot — returns the same envelope `codemap context --json` prints (project root, schema version, file/symbol counts, language breakdown, recipe catalog summary, etc.). Designed for agent session-start: one call replaces 4-5 `query` calls.",
      inputSchema: {
        compact: z.boolean().optional(),
        intent: z.string().optional(),
      },
    },
    (args) => {
      try {
        const db = openDb();
        try {
          const envelope = buildContextEnvelope(db, getProjectRoot(), {
            compact: args.compact === true,
            intent: args.intent ?? null,
          });
          return jsonResult(envelope);
        } finally {
          closeDb(db, { readonly: true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerValidateTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "validate",
    {
      description:
        "Compare on-disk SHA-256 of indexed files to the indexed `files.content_hash` column. Returns rows with status ('ok' / 'changed' / 'missing'). Empty `paths` validates every indexed file. Useful for 'codemap doctor' agents that diagnose stale .codemap.db before issuing structural queries.",
      inputSchema: {
        paths: z.array(z.string()).optional(),
      },
    },
    (args) => {
      try {
        const db = openDb();
        try {
          const rows = computeValidateRows(
            db,
            getProjectRoot(),
            args.paths ?? [],
          );
          return jsonResult(rows);
        } finally {
          closeDb(db, { readonly: true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerSaveBaselineTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "save_baseline",
    {
      description:
        "Snapshot the rows of a SQL or recipe under `name` in query_baselines. Polymorphic input: pass exactly one of `sql` (ad-hoc SELECT) or `recipe` (bundled recipe id). Mirrors `codemap query --save-baseline=<name>`'s single-verb shape; the runtime check that exactly one is set keeps the agent from accidentally saving an unintended source.",
      inputSchema: {
        name: z.string().min(1, "name must be a non-empty string"),
        sql: z.string().optional(),
        recipe: z.string().optional(),
      },
    },
    (args) => {
      try {
        if ((args.sql == null) === (args.recipe == null)) {
          return jsonError(
            "save_baseline: pass exactly one of `sql` or `recipe`.",
          );
        }
        let sql: string;
        let recipeId: string | null = null;
        if (args.recipe != null) {
          const recipeSql = getQueryRecipeSql(args.recipe);
          if (recipeSql === undefined) {
            return jsonError(
              `save_baseline: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
            );
          }
          sql = recipeSql;
          recipeId = args.recipe;
        } else {
          sql = args.sql!;
        }
        const payload = executeQuery({ sql, root: _opts.root });
        if (isEnginePayloadError(payload)) return jsonError(payload.error);
        const rows = payload as unknown[];
        const db = openDb();
        const savedAt = Date.now();
        const gitRef = tryGetGitRefSafe();
        try {
          upsertQueryBaseline(db, {
            name: args.name,
            recipe_id: recipeId,
            sql,
            rows_json: JSON.stringify(rows),
            row_count: rows.length,
            git_ref: gitRef,
            created_at: savedAt,
          });
        } finally {
          closeDb(db);
        }
        return jsonResult({
          saved: args.name,
          recipe_id: recipeId,
          row_count: rows.length,
          git_ref: gitRef,
          created_at: savedAt,
        });
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerListBaselinesTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "list_baselines",
    {
      description:
        "List all saved baselines (no rows_json payload — use the audit tool with a baseline_prefix to compare against current). Returns the same array `codemap query --baselines --json` prints.",
      inputSchema: {},
    },
    () => {
      try {
        const db = openDb();
        try {
          return jsonResult(listQueryBaselines(db));
        } finally {
          closeDb(db, { readonly: true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerDropBaselineTool(server: McpServer, _opts: ServerOpts): void {
  server.registerTool(
    "drop_baseline",
    {
      description:
        "Delete the named baseline. Returns {dropped: <name>} on success or {error} if the name doesn't exist.",
      inputSchema: {
        name: z.string().min(1, "name must be a non-empty string"),
      },
    },
    (args) => {
      try {
        const db = openDb();
        try {
          const dropped = deleteQueryBaseline(db, args.name);
          if (!dropped) {
            return jsonError(
              `drop_baseline: no baseline named "${args.name}". Call list_baselines for the catalog.`,
            );
          }
          return jsonResult({ dropped: args.name });
        } finally {
          closeDb(db);
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerShowTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "show",
    {
      description:
        "Look up symbol(s) by exact name; returns {matches: [{name, kind, file_path, line_start, line_end, signature, ...}]} with structured `disambiguation` block when multiple matches. One-step lookup that beats composing `SELECT … FROM symbols WHERE name = ?` by hand. Use `snippet` for the actual source text; use `query` with `LIKE` for fuzzy lookup.",
      inputSchema: {
        name: z.string().min(1, "name must be a non-empty string"),
        kind: z.string().optional(),
        in: z.string().optional(),
      },
    },
    (args) => {
      try {
        const db = openDb();
        try {
          const inPath =
            args.in !== undefined && args.in.length > 0
              ? toProjectRelative(opts.root, args.in)
              : undefined;
          const matches = findSymbolsByName(db, {
            name: args.name,
            kind: args.kind,
            inPath,
          });
          return jsonResult(buildShowResult(matches));
        } finally {
          closeDb(db, { readonly: true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

function registerSnippetTool(server: McpServer, opts: ServerOpts): void {
  server.registerTool(
    "snippet",
    {
      description:
        "Same lookup as `show` but each match carries `source` (file lines from disk at line_start..line_end) plus `stale` (true when content_hash drifted since indexing — line range may have shifted; agent decides whether to act or re-index) and `missing` (true when file is gone). Per-execution shape mirrors `show`'s envelope; source/stale/missing are additive fields on each match.",
      inputSchema: {
        name: z.string().min(1, "name must be a non-empty string"),
        kind: z.string().optional(),
        in: z.string().optional(),
      },
    },
    (args) => {
      try {
        const db = openDb();
        try {
          const inPath =
            args.in !== undefined && args.in.length > 0
              ? toProjectRelative(opts.root, args.in)
              : undefined;
          const matches = findSymbolsByName(db, {
            name: args.name,
            kind: args.kind,
            inPath,
          });
          return jsonResult(
            buildSnippetResult({ db, matches, projectRoot: opts.root }),
          );
        } finally {
          closeDb(db, { readonly: true });
        }
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
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

// `git rev-parse HEAD` may legitimately fail (no git, detached worktree, etc.);
// baselines just record git_ref = NULL in that case. Mirrors the same helper
// in cmd-query.ts (kept local to avoid a cli → application import).
function tryGetGitRefSafe(): string | null {
  try {
    const sha = getCurrentCommit();
    return sha || null;
  } catch {
    return null;
  }
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
