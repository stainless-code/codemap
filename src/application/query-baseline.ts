import { closeDb, getQueryBaseline, openDb } from "../db";
import { diffRows } from "../diff-rows";
import { filterRowsByChangedFiles } from "../git-changed";
import type { QueryBindValue } from "./query-engine";

export interface QueryBaselineMeta {
  name: string;
  recipe_id: string | null;
  row_count: number;
  git_ref: string | null;
  created_at: number;
}

export interface QueryBaselineDiffPayload {
  baseline: QueryBaselineMeta;
  current_row_count: number;
  added: unknown[];
  removed: unknown[];
}

export interface QueryBaselineDiffSummaryPayload {
  baseline: QueryBaselineMeta;
  current_row_count: number;
  added: number;
  removed: number;
}

export interface QueryBaselineError {
  error: string;
}

function attachActions(row: unknown, actions: ReadonlyArray<unknown>): unknown {
  if (typeof row !== "object" || row === null) return row;
  const obj = row as Record<string, unknown>;
  if ("actions" in obj) return obj;
  return { ...obj, actions };
}

/**
 * Diff current query rows against a saved `query_baselines` snapshot.
 * Mirrors CLI `codemap query --baseline=<name>`.
 */
export function compareQueryBaseline(opts: {
  baselineName: string;
  sql: string;
  bindValues?: QueryBindValue[];
  changedFiles?: Set<string>;
  summary?: boolean;
  recipeActions?: ReadonlyArray<unknown>;
}):
  | QueryBaselineDiffPayload
  | QueryBaselineDiffSummaryPayload
  | QueryBaselineError {
  const db = openDb();
  let baselineRow: ReturnType<typeof getQueryBaseline>;
  try {
    db.run("PRAGMA query_only = 1");
    baselineRow = getQueryBaseline(db, opts.baselineName);
    if (baselineRow === undefined) {
      return {
        error: `codemap: no baseline named "${opts.baselineName}". Use list_baselines for the catalog.`,
      };
    }

    let baselineRows: unknown[];
    try {
      baselineRows = JSON.parse(baselineRow.rows_json) as unknown[];
    } catch {
      return {
        error: `codemap: baseline "${opts.baselineName}" has corrupt rows_json — drop and re-save.`,
      };
    }

    let currentRows: unknown[];
    try {
      currentRows = db
        .query(opts.sql)
        .all(...(opts.bindValues ?? [])) as unknown[];
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (opts.changedFiles !== undefined) {
      currentRows = filterRowsByChangedFiles(currentRows, opts.changedFiles);
    }

    const { added, removed } = diffRows(baselineRows, currentRows);
    const enrichedAdded =
      opts.recipeActions !== undefined && opts.recipeActions.length > 0
        ? added.map((row) => attachActions(row, opts.recipeActions!))
        : added;

    const meta: QueryBaselineMeta = {
      name: baselineRow.name,
      recipe_id: baselineRow.recipe_id,
      row_count: baselineRow.row_count,
      git_ref: baselineRow.git_ref,
      created_at: baselineRow.created_at,
    };

    if (opts.summary) {
      return {
        baseline: meta,
        current_row_count: currentRows.length,
        added: added.length,
        removed: removed.length,
      };
    }

    return {
      baseline: meta,
      current_row_count: currentRows.length,
      added: enrichedAdded,
      removed,
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

/** Reject baseline + formatted output or group_by (CLI parser parity). */
export function baselineQueryIncompatibility(args: {
  baseline?: string;
  format?: string;
  group_by?: string;
  summary?: boolean;
}): string | undefined {
  if (args.baseline === undefined) return undefined;
  const offenders: string[] = [];
  if (args.format !== undefined && args.format !== "json") {
    offenders.push(`format=${args.format}`);
  }
  if (args.group_by !== undefined) offenders.push("group_by");
  if (offenders.length === 0) return undefined;
  return `codemap: baseline cannot be combined with ${offenders.join(", ")} (different output shapes).`;
}
