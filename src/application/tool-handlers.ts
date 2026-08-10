/**
 * Pure transport-agnostic tool handlers — every codemap MCP tool's body
 * extracted so HTTP (`codemap serve`) can dispatch to the
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
  createSchema,
  deleteQueryBaseline,
  listQueryBaselines,
  openDb,
  upsertQueryBaseline,
} from "../db";
import { getFilesChangedSince } from "../git-changed";
import type { GroupByMode } from "../group-by";
import { GROUP_BY_MODES } from "../group-by";
import { getProjectRoot } from "../runtime";
import {
  executeAffectedTests,
  resolveAffectedChangedPaths,
} from "./affected-engine";
import type { ApplyJsonPayload } from "./apply-engine";
import {
  ApplyRunError,
  gitCommitAfterApplyIfEligible,
  runApplyFromDiffText,
  runApplyFromRecipe,
  runApplyFromRows,
  runApplyUntilEmpty,
} from "./apply-run";
import {
  collapseAuditEnvelopeForSummary,
  makeWorktreeReindex,
  resolveAuditBaselines,
  runAudit,
  runAuditFromRef,
} from "./audit-engine";
import { buildContextEnvelope } from "./context-engine";
import { findImpact } from "./impact-engine";
import type { ImpactBackend, ImpactDirection } from "./impact-engine";
import { getCurrentCommit } from "./index-engine";
import { ingestChurnFromJsonFile } from "./ingest-churn-run";
import { runIngestCoverageOnDb } from "./ingest-coverage-run";
import type { BadgeStyle } from "./output-formatters";
import {
  formatAnnotations,
  formatBadge,
  formatBadgeJson,
  formatCodeClimate,
  formatDiff,
  formatDiffJson,
  formatMermaid,
  formatSarif,
  noLocatableFindingsWarning,
} from "./output-formatters";
import {
  baselineQueryIncompatibility,
  compareQueryBaseline,
} from "./query-baseline";
import { executeQuery } from "./query-engine";
import {
  getQueryRecipeActionsRendered,
  getQueryRecipeParams,
  getQueryRecipeCatalogEntry,
  getQueryRecipeSql,
} from "./query-recipes";
import { resolveRecipeParams } from "./recipe-params";
import type {
  RecipeParamValues,
  ResolvedRecipeParamValue,
} from "./recipe-params";
import { tryRecordRecipeRun } from "./recipe-recency";
import { runCodemapIndex } from "./run-index";
import { buildShowResult, buildSnippetResult } from "./show-engine";
import { executeShowLookup, resolveShowLookupMode } from "./show-search-mode";
import {
  composeExploreResult,
  composeNodeResult,
  composeTraceResult,
  executeCallPath,
} from "./trace-engine";
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
  | { ok: true; format: "mermaid"; payload: string }
  | { ok: true; format: "diff"; payload: string }
  | { ok: true; format: "diff-json"; payload: string }
  | { ok: true; format: "codeclimate"; payload: string }
  | { ok: true; format: "badge"; payload: string; badgeStyle: BadgeStyle }
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

function baselineCompareErr(error: string): ToolResult {
  return err(error, error.includes("no baseline named") ? 404 : 400);
}

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

export const formatEnum = z.enum([
  "json",
  "sarif",
  "annotations",
  "mermaid",
  "diff",
  "diff-json",
  "codeclimate",
  "badge",
]);

export const badgeStyleEnum = z.enum(["markdown", "json"]);

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
  badge_style: badgeStyleEnum.optional(),
  baseline: z.string().min(1).optional(),
};

export interface QueryArgs {
  sql: string;
  summary?: boolean;
  changed_since?: string;
  group_by?: GroupByMode;
  format?:
    | "json"
    | "sarif"
    | "annotations"
    | "mermaid"
    | "diff"
    | "diff-json"
    | "codeclimate"
    | "badge";
  badge_style?: BadgeStyle;
  baseline?: string;
}

export function handleQuery(args: QueryArgs, root: string): ToolResult {
  try {
    const badgeIncompat = badgeStyleIncompatibility(args.format, args);
    if (badgeIncompat !== undefined) return err(badgeIncompat);

    const baselineIncompat = baselineQueryIncompatibility(args);
    if (baselineIncompat !== undefined) return err(baselineIncompat);

    const resolveChanged = makeChangedFilesResolver(root);
    const changed = resolveChanged(args.changed_since);
    if (changed && typeof changed === "object" && "error" in changed) {
      return err(changed.error);
    }
    if (args.baseline !== undefined) {
      const payload = compareQueryBaseline({
        baselineName: args.baseline,
        sql: args.sql,
        changedFiles: changed as Set<string> | undefined,
        summary: args.summary,
      });
      if ("error" in payload) return baselineCompareErr(payload.error);
      return ok(payload);
    }
    if (args.format !== undefined && args.format !== "json") {
      const incompat = formatToolIncompatibility(args.format, args);
      if (incompat !== undefined) return err(incompat);
      return runFormattedQuery({
        sql: args.sql,
        recipeId: undefined,
        recipeActions: undefined,
        changedFiles: changed as Set<string> | undefined,
        format: args.format,
        badgeStyle: args.badge_style,
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
  badge_style: badgeStyleEnum.optional(),
  baseline: z.string().min(1).optional(),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
};

export interface QueryRecipeArgs {
  recipe: string;
  summary?: boolean;
  changed_since?: string;
  group_by?: GroupByMode;
  format?:
    | "json"
    | "sarif"
    | "annotations"
    | "mermaid"
    | "diff"
    | "diff-json"
    | "codeclimate"
    | "badge";
  badge_style?: BadgeStyle;
  baseline?: string;
  params?: RecipeParamValues;
}

export function handleQueryRecipe(
  args: QueryRecipeArgs,
  root: string,
): ToolResult {
  try {
    const badgeIncompat = badgeStyleIncompatibility(args.format, args);
    if (badgeIncompat !== undefined) return err(badgeIncompat);

    const baselineIncompat = baselineQueryIncompatibility(args);
    if (baselineIncompat !== undefined) return err(baselineIncompat);

    const sql = getQueryRecipeSql(args.recipe);
    if (sql === undefined) {
      return err(
        `codemap: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
        404,
      );
    }
    const resolvedParams = resolveRecipeParams({
      recipeId: args.recipe,
      declared: getQueryRecipeParams(args.recipe),
      provided: args.params,
    });
    if (!resolvedParams.ok) return err(resolvedParams.error);
    const recipeActions = getQueryRecipeActionsRendered(
      args.recipe,
      args.params,
    );
    const resolveChanged = makeChangedFilesResolver(root);
    const changed = resolveChanged(args.changed_since);
    if (changed && typeof changed === "object" && "error" in changed) {
      return err(changed.error);
    }
    if (args.baseline !== undefined) {
      const payload = compareQueryBaseline({
        baselineName: args.baseline,
        sql,
        bindValues: resolvedParams.values,
        changedFiles: changed as Set<string> | undefined,
        summary: args.summary,
        recipeActions,
      });
      if ("error" in payload) return baselineCompareErr(payload.error);
      tryRecordRecipeRun(args.recipe);
      return ok(payload);
    }
    if (args.format !== undefined && args.format !== "json") {
      const incompat = formatToolIncompatibility(args.format, args);
      if (incompat !== undefined) return err(incompat);
      const result = runFormattedQuery({
        sql,
        recipeId: args.recipe,
        recipeActions,
        changedFiles: changed as Set<string> | undefined,
        bindValues: resolvedParams.values,
        format: args.format,
        badgeStyle: args.badge_style,
        root,
      });
      // Successful runs only; failure-isolated inside the helper.
      if (result.ok) tryRecordRecipeRun(args.recipe);
      return result;
    }
    const payload = executeQuery({
      sql,
      summary: args.summary,
      changedFiles: changed as Set<string> | undefined,
      groupBy: args.group_by,
      recipeActions,
      bindValues: resolvedParams.values,
      root,
    });
    if (isEnginePayloadError(payload)) return err(payload.error);
    tryRecordRecipeRun(args.recipe);
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
  base: z.string().optional(),
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
  /** Git committish (origin/main, HEAD~5, sha, tag…). Mutually exclusive with baseline_prefix. */
  base?: string;
  baselines?: { files?: string; dependencies?: string; deprecated?: string };
  summary?: boolean;
  no_index?: boolean;
}

export async function handleAudit(args: AuditArgs): Promise<ToolResult> {
  if (args.base !== undefined && args.baseline_prefix !== undefined) {
    return err(
      "codemap audit: `base` and `baseline_prefix` are mutually exclusive. Use `base` for ad-hoc git-ref comparison; `baseline_prefix` for saved snapshots. Per-delta `baselines.<key>` overrides compose with either.",
    );
  }
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
      const result =
        args.base !== undefined
          ? await runAuditFromRef({
              db,
              ref: args.base,
              perDeltaOverrides: perDelta,
              projectRoot: getProjectRoot(),
              reindex: makeWorktreeReindex(),
            })
          : runAudit({
              db,
              baselines: resolveAuditBaselines({
                db,
                baselinePrefix: args.baseline_prefix,
                perDelta,
              }),
            });
      if ("error" in result) {
        return err(result.error);
      }
      if (args.summary) {
        return ok(collapseAuditEnvelopeForSummary(result));
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
  include_snippets: z.boolean().optional(),
  include_codebase_map: z.boolean().optional(),
};

export interface ContextArgs {
  compact?: boolean;
  intent?: string;
  include_snippets?: boolean;
  include_codebase_map?: boolean;
}

export function handleContext(args: ContextArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const envelope = buildContextEnvelope(db, getProjectRoot(), {
        compact: args.compact === true,
        intent: args.intent ?? null,
        include_snippets: args.include_snippets,
        include_codebase_map: args.include_codebase_map,
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
  name: z.string().min(1, "name must be a non-empty string").optional(),
  kind: z.string().optional(),
  in: z.string().optional(),
  query: z.string().min(1, "query must be a non-empty string").optional(),
  with_fts: z.boolean().optional(),
};

export interface ShowArgs {
  name?: string;
  kind?: string;
  in?: string;
  query?: string;
  with_fts?: boolean;
}

export function handleShow(args: ShowArgs, root: string): ToolResult {
  return handleShowLike(args, root, (lookup) => {
    const result = buildShowResult(lookup.matches);
    if (lookup.warning !== undefined) result.warning = lookup.warning;
    return result;
  });
}

// === snippet ================================================================

export const snippetArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string").optional(),
  kind: z.string().optional(),
  in: z.string().optional(),
  query: z.string().min(1, "query must be a non-empty string").optional(),
  with_fts: z.boolean().optional(),
};

export interface SnippetArgs {
  name?: string;
  kind?: string;
  in?: string;
  query?: string;
  with_fts?: boolean;
}

export function handleSnippet(args: SnippetArgs, root: string): ToolResult {
  return handleShowLike(args, root, (lookup, db) => {
    const result = buildSnippetResult({
      db,
      matches: lookup.matches,
      projectRoot: root,
    });
    if (lookup.warning !== undefined) result.warning = lookup.warning;
    return result;
  });
}

function handleShowLike<T>(
  args: ShowArgs,
  root: string,
  build: (
    lookup: ReturnType<typeof executeShowLookup>,
    db: ReturnType<typeof openDb>,
  ) => T,
): ToolResult {
  try {
    const mode = resolveShowLookupMode(args, root);
    if (!mode.ok) return err(mode.error, 400);

    const db = openDb();
    try {
      const lookup = executeShowLookup(db, mode, {
        withFtsCli: args.with_fts === true,
        exactKind: args.kind,
      });
      return ok(build(lookup, db));
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === affected ===============================================================

export const affectedArgsSchema = {
  paths: z.array(z.string()).optional(),
  changed_since: z.string().optional(),
  test_glob: z.string().optional(),
  max_depth: z.number().int().nonnegative().optional(),
};

export interface AffectedArgs {
  paths?: string[];
  changed_since?: string;
  test_glob?: string;
  max_depth?: number;
}

export function handleAffected(args: AffectedArgs, root: string): ToolResult {
  try {
    const pathsResult = resolveAffectedChangedPaths({
      root,
      paths: args.paths,
      changedSince: args.changed_since,
      errorStyle: "agent",
    });
    if (!pathsResult.ok) return err(pathsResult.error);

    const result = executeAffectedTests({
      root,
      changedPaths: pathsResult.paths,
      testGlob: args.test_glob,
      maxDepth: args.max_depth,
    });
    if (!result.ok) {
      return err(result.error, result.kind === "internal" ? 500 : undefined);
    }
    if (pathsResult.paths.length > 0) {
      tryRecordRecipeRun("affected-tests");
    }
    return ok(result.rows);
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
  in: z.string().min(1).optional(),
  summary: z.boolean().optional(),
};

export interface ImpactArgs {
  target: string;
  direction?: ImpactDirection;
  via?: ImpactBackend;
  depth?: number;
  limit?: number;
  in?: string;
  summary?: boolean;
}

export function handleImpact(args: ImpactArgs): ToolResult {
  try {
    const db = openDb();
    try {
      const inPath =
        args.in !== undefined && args.in.length > 0
          ? toProjectRelative(getProjectRoot(), args.in)
          : undefined;
      const result = findImpact(db, {
        target: args.target,
        direction: args.direction,
        via: args.via,
        depth: args.depth,
        limit: args.limit,
        inPath,
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

// === trace / explore / node =================================================

export const traceArgsSchema = {
  from: z.string().min(1, "from must be a non-empty string"),
  to: z.string().min(1, "to must be a non-empty string"),
  max_depth: z.number().int().nonnegative().optional(),
  via: z.enum(["calls", "dependencies", "all"]).optional(),
  budget_chars: z.number().int().positive().optional(),
};

export interface TraceArgs {
  from: string;
  to: string;
  max_depth?: number;
  via?: "calls" | "dependencies" | "all";
  budget_chars?: number;
}

export function handleTrace(args: TraceArgs, root: string): ToolResult {
  try {
    const pathResult = executeCallPath({
      root,
      from: args.from,
      to: args.to,
      maxDepth: args.max_depth,
      via: args.via,
    });
    if (!pathResult.ok) {
      return err(
        pathResult.error,
        pathResult.kind === "internal" ? 500 : undefined,
      );
    }
    const payload = composeTraceResult({
      root,
      from: args.from,
      to: args.to,
      via: args.via,
      path: pathResult.rows,
      budgetChars: args.budget_chars,
    });
    tryRecordRecipeRun("call-path");
    return ok(payload);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

export const exploreArgsSchema = {
  names: z
    .array(z.string().min(1))
    .min(1, "names must contain at least one symbol"),
  depth: z.number().int().nonnegative().optional(),
  kind: z.string().optional(),
  budget_chars: z.number().int().positive().optional(),
};

export interface ExploreArgs {
  names: string[];
  depth?: number;
  kind?: string;
  budget_chars?: number;
}

export function handleExplore(args: ExploreArgs, root: string): ToolResult {
  try {
    const composed = composeExploreResult({
      root,
      names: args.names,
      depth: args.depth,
      kind: args.kind,
      budgetChars: args.budget_chars,
    });
    if (!composed.ok) {
      return err(
        composed.error,
        composed.kind === "internal" ? 500 : undefined,
      );
    }
    tryRecordRecipeRun("symbol-neighborhood");
    return ok(composed.result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

export const nodeArgsSchema = {
  name: z.string().min(1, "name must be a non-empty string"),
  kind: z.string().optional(),
  in: z.string().optional(),
  include_snippets: z.boolean().optional(),
  budget_chars: z.number().int().positive().optional(),
};

export interface NodeArgs {
  name: string;
  kind?: string;
  in?: string;
  include_snippets?: boolean;
  budget_chars?: number;
}

export function handleNode(args: NodeArgs, root: string): ToolResult {
  try {
    const inPath =
      args.in !== undefined && args.in.length > 0
        ? toProjectRelative(root, args.in)
        : undefined;
    const composed = composeNodeResult({
      root,
      name: args.name,
      kind: args.kind,
      inPath,
      includeSnippets: args.include_snippets,
      budgetChars: args.budget_chars,
    });
    if (!composed.ok) {
      return err(
        composed.error,
        composed.kind === "internal" ? 500 : undefined,
      );
    }
    tryRecordRecipeRun("symbol-neighborhood");
    return ok(composed.result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === apply ==================================================================

export const applyRowSchema = z.object({
  file_path: z.string().min(1),
  line_start: z.number().int().positive(),
  before_pattern: z.string().min(1),
  after_pattern: z.string(),
});

export const applyArgsSchema = {
  recipe: z.string().min(1, "recipe must be a non-empty string"),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  dry_run: z.boolean().optional(),
  /** Q6 (a) — required for the write path; non-TTY transports have no prompt to fall back on. */
  yes: z.boolean().optional(),
  force: z.boolean().optional(),
  until_empty: z.boolean().optional(),
  max_passes: z.number().int().positive().optional(),
  commit_message: z.string().min(1).optional(),
};

export interface ApplyArgs {
  recipe: string;
  params?: RecipeParamValues;
  dry_run?: boolean;
  yes?: boolean;
  force?: boolean;
  until_empty?: boolean;
  max_passes?: number;
  commit_message?: string;
}

export const applyDiffInputArgsSchema = {
  diff_text: z.string().min(1),
  dry_run: z.boolean().optional(),
  yes: z.boolean().optional(),
  commit_message: z.string().min(1).optional(),
};

export interface ApplyDiffInputArgs {
  diff_text: string;
  dry_run?: boolean;
  yes?: boolean;
  commit_message?: string;
}

export const applyRowsArgsSchema = {
  rows: z.array(applyRowSchema).min(1),
  dry_run: z.boolean().optional(),
  yes: z.boolean().optional(),
};

export interface ApplyRowsArgs {
  rows: Array<{
    file_path: string;
    line_start: number;
    before_pattern: string;
    after_pattern: string;
  }>;
  dry_run?: boolean;
  yes?: boolean;
}

function assertApplyTransportConsent(
  dryRun: boolean,
  yes: boolean | undefined,
): string | undefined {
  if (dryRun && yes === true) {
    return `codemap apply: dry_run and yes are mutually exclusive (dry_run never writes).`;
  }
  if (!dryRun && yes !== true) {
    return `codemap apply: this tool writes files. Pass {yes: true} for non-interactive runs, or {dry_run: true} for preview.`;
  }
  return undefined;
}

function maybeGitCommitAfterApply(
  payload: ApplyJsonPayload,
  commitMessage: string | undefined,
  projectRoot: string,
): string | undefined {
  if (commitMessage === undefined) return undefined;
  return gitCommitAfterApplyIfEligible({
    projectRoot,
    message: commitMessage,
    payload,
  });
}

/**
 * Substrate-shaped fix executor — recipe SQL → row contract →
 * {@link runApplyFromRecipe} (Q5 envelope). Non-`dry_run` requires `yes: true`.
 */
export async function handleApply(
  args: ApplyArgs,
  root: string,
): Promise<ToolResult> {
  try {
    const dryRun = args.dry_run === true;
    const consentErr = assertApplyTransportConsent(dryRun, args.yes);
    if (consentErr !== undefined) return err(consentErr);

    if (getQueryRecipeSql(args.recipe) === undefined) {
      return err(
        `codemap: unknown recipe "${args.recipe}". List available recipes via the codemap://recipes resource.`,
        404,
      );
    }

    const loopResult =
      args.until_empty === true
        ? await runApplyUntilEmpty({
            projectRoot: root,
            recipeId: args.recipe,
            params: args.params,
            dryRun,
            force: args.force === true,
            yes: args.yes === true,
            maxPasses: args.max_passes ?? 10,
          })
        : runApplyFromRecipe({
            projectRoot: root,
            recipeId: args.recipe,
            params: args.params,
            dryRun,
            force: args.force === true,
            yes: args.yes === true,
          });

    const gitErr = maybeGitCommitAfterApply(
      loopResult.payload,
      args.commit_message,
      root,
    );
    if (gitErr !== undefined) return err(gitErr, 400);
    return ok(loopResult.payload);
  } catch (e) {
    if (e instanceof ApplyRunError) return err(e.message, 400);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

/** Unified diff → row contract → {@link runApplyFromDiffText} (CLI `--diff-input` twin). */
export async function handleApplyDiffInput(
  args: ApplyDiffInputArgs,
  root: string,
): Promise<ToolResult> {
  try {
    const dryRun = args.dry_run === true;
    const consentErr = assertApplyTransportConsent(dryRun, args.yes);
    if (consentErr !== undefined) return err(consentErr);

    const { payload } = runApplyFromDiffText({
      projectRoot: root,
      diffText: args.diff_text,
      dryRun,
    });
    const gitErr = maybeGitCommitAfterApply(payload, args.commit_message, root);
    if (gitErr !== undefined) return err(gitErr, 400);
    return ok(payload);
  } catch (e) {
    if (e instanceof ApplyRunError) return err(e.message, 400);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

/** Agent-in-the-loop apply — explicit row contract (Step 8). */
export function handleApplyRows(args: ApplyRowsArgs, root: string): ToolResult {
  try {
    const dryRun = args.dry_run === true;
    const consentErr = assertApplyTransportConsent(dryRun, args.yes);
    if (consentErr !== undefined) return err(consentErr);

    const { payload } = runApplyFromRows({
      projectRoot: root,
      rows: args.rows,
      dryRun,
    });
    return ok(payload);
  } catch (e) {
    if (e instanceof ApplyRunError) return err(e.message, 400);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === ingest_coverage ========================================================

export const ingestCoverageArgsSchema = {
  path: z.string().min(1, "path must be a non-empty string"),
  runtime: z.boolean().optional(),
};

export interface IngestCoverageArgs {
  path: string;
  runtime?: boolean;
}

export async function handleIngestCoverage(
  args: IngestCoverageArgs,
  root: string,
): Promise<ToolResult> {
  try {
    const db = openDb();
    let outcome: Awaited<ReturnType<typeof runIngestCoverageOnDb>>;
    try {
      outcome = await runIngestCoverageOnDb(db, {
        projectRoot: root,
        path: args.path,
        runtime: args.runtime,
      });
    } finally {
      closeDb(db);
    }
    if (!outcome.ok) return err(outcome.error);
    return ok(outcome.result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === ingest_churn ===========================================================

export const ingestChurnArgsSchema = {
  path: z.string().min(1, "path must be a non-empty string"),
};

export interface IngestChurnArgs {
  path: string;
}

export function handleIngestChurn(
  args: IngestChurnArgs,
  root: string,
): ToolResult {
  try {
    const db = openDb();
    try {
      createSchema(db);
      const indexedCount =
        db.query<{ n: number }>("SELECT COUNT(*) AS n FROM files").get()?.n ??
        0;
      if (indexedCount === 0) {
        return err(
          "codemap ingest-churn: no indexed files — run `codemap` or `codemap --full` first",
        );
      }
      const outcome = ingestChurnFromJsonFile(db, {
        projectRoot: root,
        path: args.path,
      });
      if (!outcome.ok) return err(outcome.error);
      return ok({
        ingested: outcome.ingested,
        skipped_unindexed: outcome.skipped_unindexed,
        sourcePath: outcome.sourcePath,
      });
    } finally {
      closeDb(db);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// === shared format helpers ===================================================

/**
 * Reject formatted-output combinations that
 * change the output shape away from a flat row list. Mirrors the CLI
 * parser's `formatIncompatibility` for the tool wrapper layer.
 */
function badgeStyleIncompatibility(
  fmt: QueryArgs["format"] | undefined,
  args: { badge_style?: BadgeStyle },
): string | undefined {
  if (args.badge_style === undefined || args.badge_style === "markdown") {
    return undefined;
  }
  if (fmt !== "badge") {
    return "codemap: badge_style is only valid with format=badge.";
  }
  return undefined;
}

function formatToolIncompatibility(
  fmt:
    | "sarif"
    | "annotations"
    | "mermaid"
    | "diff"
    | "diff-json"
    | "codeclimate"
    | "badge",
  args: { summary?: boolean; group_by?: GroupByMode },
): string | undefined {
  const offenders: string[] = [];
  if (args.summary === true) offenders.push("summary");
  if (args.group_by !== undefined) offenders.push("group_by");
  if (offenders.length === 0) return undefined;
  return `codemap: format=${fmt} cannot be combined with ${offenders.join(", ")} (different output shapes — formatted outputs only support flat row lists).`;
}

function runFormattedQuery(args: {
  sql: string;
  recipeId: string | undefined;
  recipeActions: ReadonlyArray<unknown> | undefined;
  changedFiles: Set<string> | undefined;
  bindValues?: ResolvedRecipeParamValue[] | undefined;
  format:
    | "sarif"
    | "annotations"
    | "mermaid"
    | "diff"
    | "diff-json"
    | "codeclimate"
    | "badge";
  badgeStyle?: BadgeStyle | undefined;
  root: string;
}): ToolResult {
  const payload = executeQuery({
    sql: args.sql,
    changedFiles: args.changedFiles,
    recipeActions: args.recipeActions,
    bindValues: args.bindValues,
    root: args.root,
  });
  if (isEnginePayloadError(payload)) return err(payload.error);
  if (!Array.isArray(payload)) {
    return err("codemap: internal — formatted output requires flat row list.");
  }
  const rows = payload as Record<string, unknown>[];
  const locWarning = noLocatableFindingsWarning(args.format, rows);
  if (locWarning !== undefined) console.error(locWarning);
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
  if (args.format === "mermaid") {
    try {
      const text = formatMermaid({ rows, recipeId: args.recipeId });
      return { ok: true, format: "mermaid", payload: text };
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }
  if (args.format === "diff") {
    const text = formatDiff({ rows, projectRoot: args.root });
    return { ok: true, format: "diff", payload: text };
  }
  if (args.format === "diff-json") {
    const text = formatDiffJson({ rows, projectRoot: args.root });
    return { ok: true, format: "diff-json", payload: text };
  }
  if (args.format === "codeclimate") {
    const text = formatCodeClimate({ rows, recipeId: args.recipeId });
    return { ok: true, format: "codeclimate", payload: text };
  }
  if (args.format === "badge") {
    const formatOpts = { rows, recipeId: args.recipeId };
    const style = args.badgeStyle ?? "markdown";
    const text =
      style === "json" ? formatBadgeJson(formatOpts) : formatBadge(formatOpts);
    return { ok: true, format: "badge", payload: text, badgeStyle: style };
  }
  const text = formatAnnotations({
    rows,
    recipeId: args.recipeId,
  });
  return { ok: true, format: "annotations", payload: text };
}
