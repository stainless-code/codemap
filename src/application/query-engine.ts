import { closeDb, openDb } from "../db";
import { filterRowsByChangedFiles } from "../git-changed";
import {
  discoverWorkspaceRoots,
  firstDirectory,
  groupRowsBy,
  loadCodeowners,
  makePackageBucketizer,
} from "../group-by";
import type { Bucketizer, GroupByMode } from "../group-by";

/**
 * SQLite bind value — the union accepted by `db.query(sql).all(...values)`.
 * Kept here at the DB boundary so `executeQuery` doesn't depend on any
 * recipe-layer type. Recipe coercion lives in `application/recipe-params.ts`
 * and produces values assignable to this union.
 */
export type QueryBindValue = string | number | bigint | boolean | null;

/**
 * Pure, transport-agnostic query execution. Mirrors the layering of
 * `audit-engine.ts` / `index-engine.ts` — CLI shells (`cmd-query.ts`)
 * and the MCP server (`mcp-server.ts`) both call into this engine
 * instead of duplicating the result-shaping logic.
 *
 * `executeQuery` replaces the JSON branch of `printQueryResult` /
 * `runGroupedQuery` from `cmd-query.ts` — the CLI version still owns
 * console-table rendering for terminal output. Engine returns the
 * exact JSON envelope `--json` would print so MCP responses are
 * structurally identical to CLI output (plan § 4 uniformity).
 */

export interface ExecuteQueryOpts {
  sql: string;
  summary?: boolean;
  /**
   * Pre-resolved set of project-relative file paths that changed since
   * a git ref. The CLI layer / MCP layer is responsible for translating
   * `--changed-since <ref>` into this set via `git-changed.ts` — the
   * engine stays git-agnostic.
   */
  changedFiles?: Set<string> | undefined;
  groupBy?: GroupByMode | undefined;
  recipeActions?: ReadonlyArray<unknown> | undefined;
  bindValues?: QueryBindValue[] | undefined;
  root: string;
}

/**
 * The JSON envelope `executeQuery` returns on success — same shape
 * `codemap query --json` prints. Discriminated by which flags were set:
 * raw `unknown[]` for default reads, `{count}` under `summary`,
 * `{group_by, groups}` under `groupBy` (groups carry full row arrays
 * by default; counts only when `summary` is also true).
 */
export type QueryResultPayload =
  | unknown[]
  | { count: number }
  | { group_by: GroupByMode; groups: unknown[] }
  | {
      group_by: GroupByMode;
      groups: Array<{ key: string; count: number }>;
    };

/**
 * In-band failure shape returned for SQL errors, group_by misconfig,
 * and other recoverable failures. Mirrors the `{"error":"…"}` shape the
 * CLI's `--json` flag emits — callers that care can narrow with
 * `"error" in payload` (or use `isEnginePayloadError` from `mcp-server`).
 */
export interface ExecuteQueryError {
  error: string;
}

/**
 * Run one SQL statement and return the JSON envelope that `--json`
 * would print. Caller owns DB lifecycle decisions only insofar as the
 * shared `openDb()` / `closeDb()` pair is used inside; this matches
 * `printQueryResult`'s self-contained connection management.
 */
export function executeQuery(
  opts: ExecuteQueryOpts,
): QueryResultPayload | ExecuteQueryError {
  const db = openDb();
  try {
    // SQLite-level read-only enforcement — rejects DML / DDL (DELETE, DROP,
    // UPDATE, ATTACH, …) on this connection regardless of the SQL the caller
    // passes. Defence in depth: every consumer of `executeQuery` (MCP `query`,
    // `query_recipe`, `query_batch`, `save_baseline`'s row capture) is
    // contractually read-only; this guard turns the contract into a parser-
    // proof boundary. Doesn't bleed across calls — `closeDb()` discards the
    // connection.
    db.run("PRAGMA query_only = 1");
    let rows = db.query(opts.sql).all(...(opts.bindValues ?? [])) as unknown[];

    if (opts.changedFiles !== undefined) {
      rows = filterRowsByChangedFiles(rows, opts.changedFiles);
    }

    if (opts.groupBy !== undefined) {
      const bucketize = resolveBucketizer(opts.groupBy, opts.root);
      if ("error" in bucketize) return bucketize;

      const enriched =
        opts.recipeActions !== undefined && opts.recipeActions.length > 0
          ? rows.map((row) => attachActions(row, opts.recipeActions!))
          : rows;
      const noBucketLabel =
        opts.groupBy === "owner" ? "<no-owner>" : "<unknown>";
      const grouped = groupRowsBy(enriched, bucketize.fn, noBucketLabel);

      if (opts.summary) {
        return {
          group_by: opts.groupBy,
          groups: grouped.map((g) => ({ key: g.key, count: g.count })),
        };
      }
      return { group_by: opts.groupBy, groups: grouped };
    }

    if (opts.summary) {
      return { count: rows.length };
    }

    if (opts.recipeActions !== undefined && opts.recipeActions.length > 0) {
      return rows.map((row) => attachActions(row, opts.recipeActions!));
    }
    return rows;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

/**
 * One statement in a batch. `string` form inherits all batch-wide
 * defaults; object form overrides on a per-key basis. The MCP wrapper
 * resolves these into `ExecuteQueryOpts` (including translating any
 * `changed_since` strings into `changedFiles` sets) before calling
 * the engine.
 */
export type BatchStatementResolved = Omit<ExecuteQueryOpts, "root">;

/**
 * Run N statements; one DB connection per call (cheap with `bun:sqlite`).
 * Returns N envelopes — same per-element shape as single `executeQuery`
 * for the effective flag set on that statement (plan § 5: "per-element
 * shape mirrors single `query`'s output for the effective flag set").
 *
 * Errors are per-statement: a failed statement returns `{error}` in its
 * slot; sibling statements still execute. Matches the "partial success"
 * semantic the agent expects when batching independent reads.
 */
export function executeQueryBatch(opts: {
  statements: BatchStatementResolved[];
  root: string;
}): Array<QueryResultPayload | ExecuteQueryError> {
  return opts.statements.map((s) => executeQuery({ ...s, root: opts.root }));
}

function resolveBucketizer(
  groupBy: GroupByMode,
  root: string,
): { fn: Bucketizer } | ExecuteQueryError {
  if (groupBy === "owner") {
    const fn = loadCodeowners(root);
    if (fn === null) {
      return {
        error:
          "--group-by owner: no CODEOWNERS file found (looked in .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS).",
      };
    }
    return { fn };
  }
  if (groupBy === "package") {
    return { fn: makePackageBucketizer(discoverWorkspaceRoots(root)) };
  }
  return { fn: (path: string) => firstDirectory(path) };
}

function attachActions(row: unknown, actions: ReadonlyArray<unknown>): unknown {
  if (typeof row !== "object" || row === null) return row;
  const obj = row as Record<string, unknown>;
  if ("actions" in obj) return obj;
  return { ...obj, actions };
}
