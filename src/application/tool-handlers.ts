/**
 * Pure transport-agnostic tool handlers — every codemap MCP tool's body
 * extracted so HTTP (`codemap serve`, planned PR #44+) can dispatch to the
 * exact same logic without depending on the MCP SDK.
 *
 * Contract: each handler takes the args object the MCP `inputSchema`
 * validates and returns a {@link ToolResult}. The MCP wrapper translates
 * `ToolResult` into `{content: [{type, text}]} / isError` envelopes; the
 * HTTP wrapper translates the same `ToolResult` into `(status, body)` with
 * a `Content-Type` derived from `format`.
 *
 * Handlers never throw — caught errors map to `{ok: false, error}`.
 *
 * Schemas (`*Schema`) are exported for both transports to reuse:
 *   - MCP wrapper passes them to `server.registerTool(...)`'s `inputSchema`.
 *   - HTTP wrapper uses them to validate request bodies before dispatch.
 */

import { z } from "zod";

import {
  closeDb,
  deleteQueryBaseline,
  listQueryBaselines,
  openDb,
  upsertQueryBaseline,
} from "../db";
import { getFilesChangedSince } from "../git-changed";
import type { GroupByMode } from "../group-by";
import { GROUP_BY_MODES } from "../group-by";
import { getProjectRoot } from "../runtime";
import { resolveAuditBaselines, runAudit } from "./audit-engine";
import { buildContextEnvelope } from "./context-engine";
import { findImpact } from "./impact-engine";
import type { ImpactBackend, ImpactDirection } from "./impact-engine";
import { getCurrentCommit } from "./index-engine";
import { formatAnnotations, formatSarif } from "./output-formatters";
import { executeQuery } from "./query-engine";
import {
  getQueryRecipeActions,
  getQueryRecipeCatalogEntry,
  getQueryRecipeSql,
} from "./query-recipes";
import { runCodemapIndex } from "./run-index";
import {
  buildShowResult,
  buildSnippetResult,
  findSymbolsByName,
} from "./show-engine";
import { computeValidateRows, toProjectRelative } from "./validate-engine";
import { isWatchActive } from "./watcher";

/**
 * Discriminated union every handler returns. `format` distinguishes JSON
 * envelopes (the default — `codemap query --json` shape) from already-
 * formatted text payloads (SARIF doc / GH-annotation lines) so the HTTP
 * wrapper can pick the right `Content-Type` (`application/sarif+json` /
 * `text/plain`) without parsing the payload.
 *
 * Error arm carries an optional `status` so the HTTP transport can map
 * to distinct codes (404 for not-found, 500 for engine-throws); MCP
 * ignores it (everything is `isError: true` on the wire). Default 400
 * — matches the existing CLI `{"error": ...}` semantics where
 * unparseable / invalid input was always the assumption.
 */
export type ToolResult =
  | { ok: true; format: "json"; payload: unknown }
  | { ok: true; format: "sarif"; payload: string }
  | { ok: true; format: "annotations"; payload: string }
  | { ok: false; error: string; status?: 400 | 404 | 500 };

const ok = (payload: unknown): ToolResult => ({
  ok: true,
  format: "json",
  payload,
});
const err = (error: string, status: 400 | 404 | 500 = 400): ToolResult => ({
  ok: false,
  error,
  status,
});

/**
 * Resolve `changed_since: <ref>` to a Set of project-relative paths.
 * Memoised per (root, ref) pair so a batch with N items sharing the same
 * ref does one git invocation instead of N.
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
 * Engine helpers (`executeQuery` / `runAudit`) return either a result
 * payload OR `{error}` for in-band failures. Narrows that union cheaply
 * for the tool handlers; centralised so the type-guard logic stays in
 * one place.
 */
function isEnginePayloadError(payload: unknown): payload is { error: string } {
  return (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  );
}

// `git rev-parse HEAD` may legitimately fail (no git, detached worktree,
// etc.); baselines record git_ref = NULL in that case.
function tryGetGitRefSafe(): string | null {
  try {
    const sha = getCurrentCommit();
    return sha || null;
  } catch {
    return null;
  }
}

// Shared schema fragments — exported so MCP `inputSchema` references the
// same Zod objects HTTP body validation will use.
export const groupByEnum = z.enum(
  GROUP_BY_MODES as unknown as readonly [GroupByMode, ...GroupByMode[]],
);

export const formatEnum = z.enum(["json", "sarif", "annotations"]);

export const batchItemSchema = z.union([
  z.string().min(1, "sql must be a non-empty string"),
  z.object({
    sql: z.string().min(1, "sql must be a non-empty string"),
    summary: z.boolean().optional(),
    changed_since: z.string().optional(),
    group_by: groupByEnum.optional(),
  }),
]);

// === query ==================================================================

export const queryArgsSchema = {
  sql: z.string().min(1, "sql must be a non-empty string"),
  summary: z.boolean().optional(),
  changed_since: z.string().optional(),
  group_by: groupByEnum.optional(),
  format: formatEnum.optional(),
};

export interface QueryArgs {
  sql: string;
  summary?: boolean;
  changed_since?: string;
  group_by?: GroupByMode;
  format?: "json" | "sarif" | "annotations";
}

export function handleQuery(args: QueryArgs, root: string): ToolResult {
  try {
    const resolveChanged = makeChangedFilesResolver(root);
    const changed = resolveChanged(args.changed_since);
    if (changed && typeof changed === "object" && "error" in changed) {
      return err(changed.error);
    }
    if (args.format === "sarif" || args.format === "annotations") {
      const incompat = formatToolIncompatibility(args.format, args);
      if (incompat !== undefined) return err(incompat);
      return runFormattedQuery({
        sql: args.sql,
        recipeId: undefined,
        recipeActions: undefined,
        changedFiles: changed as Set<string> | undefined,
        format: args.format,
        root,
      });
    }
    const payload = executeQuery({
      sql: args.sql,
      summary: args.summary,
      changedFiles: changed as Set<string> | undefined,
      groupBy: args.group_by,
      root,
    });
    if (isEnginePayloadError(payload)) return err(payload.error);
    return ok(payload);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === query_recipe ===========================================================

export const queryRecipeArgsSchema = {
  recipe: z.string().min(1, "recipe must be a non-empty string"),
  summary: z.boolean().optional(),
  changed_since: z.string().optional(),
  group_by: groupByEnum.optional(),
  format: formatEnum.optional(),
};

export interface QueryRecipeArgs {
  recipe: string;
  summary?: boolean;
  changed_since?: string;
  group_by?: GroupByMode;
  format?: "json" | "sarif" | "annotations";
}

export function handleQueryRecipe(
  args: QueryRecipeArgs,
  root: string,
): ToolResult {
  try {
    const sql = getQueryRecipeSql(args.recipe);
    if (sql === undefined) {
      return err(
        `codemap: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
        404,
      );
    }
    const recipeActions = getQueryRecipeActions(args.recipe);
    const resolveChanged = makeChangedFilesResolver(root);
    const changed = resolveChanged(args.changed_since);
    if (changed && typeof changed === "object" && "error" in changed) {
      return err(changed.error);
    }
    if (args.format === "sarif" || args.format === "annotations") {
      const incompat = formatToolIncompatibility(args.format, args);
      if (incompat !== undefined) return err(incompat);
      return runFormattedQuery({
        sql,
        recipeId: args.recipe,
        recipeActions,
        changedFiles: changed as Set<string> | undefined,
        format: args.format,
        root,
      });
    }
    const payload = executeQuery({
      sql,
      summary: args.summary,
      changedFiles: changed as Set<string> | undefined,
      groupBy: args.group_by,
      recipeActions,
      root,
    });
    if (isEnginePayloadError(payload)) return err(payload.error);
    return ok(payload);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === query_batch ============================================================

export const queryBatchArgsSchema = {
  statements: z.array(batchItemSchema).min(1),
  summary: z.boolean().optional(),
  changed_since: z.string().optional(),
  group_by: groupByEnum.optional(),
};

export interface QueryBatchArgs {
  statements: z.infer<typeof batchItemSchema>[];
  summary?: boolean;
  changed_since?: string;
  group_by?: GroupByMode;
}

export function handleQueryBatch(
  args: QueryBatchArgs,
  root: string,
): ToolResult {
  try {
    const resolveChanged = makeChangedFilesResolver(root);
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
          root,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    return ok(results);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
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
  return {
    sql: item.sql,
    summary: item.summary ?? defaults.summary,
    changed_since: item.changed_since ?? defaults.changed_since,
    group_by: item.group_by ?? defaults.group_by,
  };
}

// === audit ==================================================================

export const auditArgsSchema = {
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
};

export interface AuditArgs {
  baseline_prefix?: string;
  baselines?: { files?: string; dependencies?: string; deprecated?: string };
  summary?: boolean;
  no_index?: boolean;
}

export async function handleAudit(args: AuditArgs): Promise<ToolResult> {
  // Skip the incremental-index prelude when the watcher already keeps
  // the index fresh (mcp --watch / serve --watch). Explicit
  // `no_index: false` is honored even when watch is on (escape hatch
  // for the rare "force a re-index right now" case). Computed up-front
  // so the inner `finally` can also use it for the readonly close hint.
  const watchKeepsIndexFresh = isWatchActive() && args.no_index !== false;
  const shouldRunPrelude = !args.no_index && !watchKeepsIndexFresh;
  try {
    const db = openDb();
    try {
      if (shouldRunPrelude) {
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
        return err(result.error);
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
        return ok({ head: result.head, deltas: counts });
      }
      return ok(result);
    } finally {
      // Mark the connection readonly when no write happened — same
      // condition as `shouldRunPrelude`. Without this, closeDb runs a
      // checkpoint pass that's wasted on a watcher-fresh DB.
      closeDb(db, { readonly: !shouldRunPrelude });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === context ================================================================

export const contextArgsSchema = {
  compact: z.boolean().optional(),
  intent: z.string().optional(),
};

export interface ContextArgs {
  compact?: boolean;
  intent?: string;
}

export function handleContext(args: ContextArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const envelope = buildContextEnvelope(db, getProjectRoot(), {
        compact: args.compact === true,
        intent: args.intent ?? null,
      });
      return ok(envelope);
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === validate ===============================================================

export const validateArgsSchema = {
  paths: z.array(z.string()).optional(),
};

export interface ValidateArgs {
  paths?: string[];
}

export function handleValidate(args: ValidateArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const rows = computeValidateRows(db, getProjectRoot(), args.paths ?? []);
      return ok(rows);
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === save_baseline ==========================================================

export const saveBaselineArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string"),
  sql: z.string().optional(),
  recipe: z.string().optional(),
};

export interface SaveBaselineArgs {
  name: string;
  sql?: string;
  recipe?: string;
}

export function handleSaveBaseline(
  args: SaveBaselineArgs,
  root: string,
): ToolResult {
  try {
    if ((args.sql == null) === (args.recipe == null)) {
      return err("save_baseline: pass exactly one of `sql` or `recipe`.");
    }
    let sql: string;
    let recipeId: string | null = null;
    if (args.recipe != null) {
      const recipeSql = getQueryRecipeSql(args.recipe);
      if (recipeSql === undefined) {
        return err(
          `save_baseline: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
          404,
        );
      }
      sql = recipeSql;
      recipeId = args.recipe;
    } else {
      sql = args.sql!;
    }
    const payload = executeQuery({ sql, root });
    if (isEnginePayloadError(payload)) return err(payload.error);
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
    return ok({
      saved: args.name,
      recipe_id: recipeId,
      row_count: rows.length,
      git_ref: gitRef,
      created_at: savedAt,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === list_baselines =========================================================

export const listBaselinesArgsSchema = {};
export type ListBaselinesArgs = Record<string, never>;

export function handleListBaselines(): ToolResult {
  try {
    const db = openDb();
    try {
      return ok(listQueryBaselines(db));
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === drop_baseline ==========================================================

export const dropBaselineArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string"),
};

export interface DropBaselineArgs {
  name: string;
}

export function handleDropBaseline(args: DropBaselineArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const dropped = deleteQueryBaseline(db, args.name);
      if (!dropped) {
        return err(
          `drop_baseline: no baseline named "${args.name}". Call list_baselines for the catalog.`,
          404,
        );
      }
      return ok({ dropped: args.name });
    } finally {
      closeDb(db);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === show ===================================================================

export const showArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string"),
  kind: z.string().optional(),
  in: z.string().optional(),
};

export interface ShowArgs {
  name: string;
  kind?: string;
  in?: string;
}

export function handleShow(args: ShowArgs, root: string): ToolResult {
  try {
    const db = openDb();
    try {
      const inPath =
        args.in !== undefined && args.in.length > 0
          ? toProjectRelative(root, args.in)
          : undefined;
      const matches = findSymbolsByName(db, {
        name: args.name,
        kind: args.kind,
        inPath,
      });
      return ok(buildShowResult(matches));
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === snippet ================================================================

export const snippetArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string"),
  kind: z.string().optional(),
  in: z.string().optional(),
};

export interface SnippetArgs {
  name: string;
  kind?: string;
  in?: string;
}

export function handleSnippet(args: SnippetArgs, root: string): ToolResult {
  try {
    const db = openDb();
    try {
      const inPath =
        args.in !== undefined && args.in.length > 0
          ? toProjectRelative(root, args.in)
          : undefined;
      const matches = findSymbolsByName(db, {
        name: args.name,
        kind: args.kind,
        inPath,
      });
      return ok(buildSnippetResult({ db, matches, projectRoot: root }));
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === impact =================================================================

export const impactArgsSchema = {
  target: z.string().min(1, "target must be a non-empty string"),
  direction: z.enum(["up", "down", "both"]).optional(),
  via: z.enum(["dependencies", "calls", "imports", "all"]).optional(),
  depth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  summary: z.boolean().optional(),
};

export interface ImpactArgs {
  target: string;
  direction?: ImpactDirection;
  via?: ImpactBackend;
  depth?: number;
  limit?: number;
  summary?: boolean;
}

export function handleImpact(args: ImpactArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const result = findImpact(db, {
        target: args.target,
        direction: args.direction,
        via: args.via,
        depth: args.depth,
        limit: args.limit,
      });
      // mirrors cmd-impact.ts: trim `matches`, keep `summary.nodes`.
      const payload =
        args.summary === true
          ? { ...result, matches: [] as typeof result.matches }
          : result;
      return ok(payload);
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === shared format helpers (sarif / annotations) ============================

/**
 * Reject `format: "sarif" | "annotations"` combinations that change the
 * output shape away from a flat row list. Mirrors the CLI parser's
 * `formatIncompatibility` (parser-side) for the tool wrapper layer.
 */
function formatToolIncompatibility(
  fmt: "sarif" | "annotations",
  args: { summary?: boolean; group_by?: GroupByMode },
): string | undefined {
  const offenders: string[] = [];
  if (args.summary === true) offenders.push("summary");
  if (args.group_by !== undefined) offenders.push("group_by");
  if (offenders.length === 0) return undefined;
  return `codemap: format=${fmt} cannot be combined with ${offenders.join(", ")} (different output shapes — sarif/annotations only support flat row lists).`;
}

function runFormattedQuery(args: {
  sql: string;
  recipeId: string | undefined;
  recipeActions: ReadonlyArray<unknown> | undefined;
  changedFiles: Set<string> | undefined;
  format: "sarif" | "annotations";
  root: string;
}): ToolResult {
  const payload = executeQuery({
    sql: args.sql,
    changedFiles: args.changedFiles,
    recipeActions: args.recipeActions,
    root: args.root,
  });
  if (isEnginePayloadError(payload)) return err(payload.error);
  if (!Array.isArray(payload)) {
    return err("codemap: internal — formatted output requires flat row list.");
  }
  const rows = payload as Record<string, unknown>[];
  if (args.format === "sarif") {
    const catalog =
      args.recipeId !== undefined
        ? getQueryRecipeCatalogEntry(args.recipeId)
        : undefined;
    const text = formatSarif({
      rows,
      recipeId: args.recipeId,
      recipeDescription: catalog?.description,
      recipeBody: catalog?.body,
    });
    return { ok: true, format: "sarif", payload: text };
  }
  const text = formatAnnotations({
    rows,
    recipeId: args.recipeId,
  });
  return { ok: true, format: "annotations", payload: text };
}
