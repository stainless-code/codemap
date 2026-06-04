/**
 * Phase-2 call resolution: bind callee names on `calls` rows using the same
 * import / scope / re-export logic as {@link resolveBindings}.
 */

import type { BindingRow, CodemapDatabase, UnresolvedCallRow } from "../db";
import {
  clearAllCallResolutions,
  clearCallResolutionsForFiles,
  insertUnresolvedCalls,
  setMeta,
  updateCallResolution,
} from "../db";
import { loadBindingIndexContext, resolveNameAtSite } from "./bindings-engine";
import type { BindingIndexContext } from "./bindings-engine";

export const META_UNRESOLVED_CALLS_RESIDUAL = "unresolved_calls_residual";

interface CallRowDb {
  id: number;
  file_path: string;
  caller_scope: string;
  callee_name: string;
  line_start: number;
  column_start: number;
  is_method_call: number;
}

/** Member / `this` chains: resolve the terminal identifier name. */
export function calleeBindingName(calleeName: string): string {
  if (!calleeName.includes(".")) return calleeName;
  const parts = calleeName.split(".");
  return parts[parts.length - 1] ?? calleeName;
}

export function scopeLocalIdForLine(
  db: CodemapDatabase,
  filePath: string,
  lineStart: number,
): number {
  const row = db
    .query<{ local_id: number }>(
      `SELECT local_id FROM scopes
       WHERE file_path = ? AND line_start <= ? AND line_end >= ?
       ORDER BY (line_end - line_start) ASC, local_id DESC
       LIMIT 1`,
    )
    .get(filePath, lineStart, lineStart);
  return row?.local_id ?? 0;
}

function isCallResolved(
  result: Pick<BindingRow, "resolved_symbol_id" | "resolution_kind">,
): boolean {
  if (result.resolved_symbol_id != null) return true;
  const kind = result.resolution_kind;
  return (
    kind === "imported" ||
    kind === "global" ||
    kind === "re-exported" ||
    kind === "same-file"
  );
}

function resolveOneCall(
  ctx: BindingIndexContext,
  db: CodemapDatabase,
  call: CallRowDb,
): { resolved: boolean; queue: boolean } {
  // Receiver-aware member resolution is deferred — binding the terminal
  // identifier alone mis-resolves `obj.method()` as a module import of `method`.
  if (call.is_method_call) {
    return { resolved: false, queue: false };
  }

  const bindingName = calleeBindingName(call.callee_name);
  const scopeLocalId = scopeLocalIdForLine(db, call.file_path, call.line_start);
  const result = resolveNameAtSite(ctx, {
    file_path: call.file_path,
    name: bindingName,
    scope_local_id: scopeLocalId,
    kind: "value",
  });

  if (isCallResolved(result)) {
    updateCallResolution(
      db,
      call.id,
      result.resolved_symbol_id,
      result.resolution_kind,
    );
    return { resolved: true, queue: false };
  }

  updateCallResolution(db, call.id, null, "unresolved");
  return { resolved: false, queue: true };
}

export interface ResolveCallsResult {
  total: number;
  resolved: number;
  unresolved: number;
}

/**
 * Batch-resolve `calls` for all indexed rows or a scoped file set.
 * Clears prior resolution state for the scope, then repopulates
 * `unresolved_calls` for sites that stay unresolved.
 */
export function resolveCalls(
  db: CodemapDatabase,
  options?: { filePaths?: readonly string[] },
): ResolveCallsResult {
  const filePaths = options?.filePaths;
  if (filePaths?.length) {
    clearCallResolutionsForFiles(db, filePaths);
  } else {
    clearAllCallResolutions(db);
  }

  const ctx = loadBindingIndexContext(db);
  const createdAt = new Date().toISOString();

  let sql =
    "SELECT id, file_path, caller_scope, callee_name, line_start, column_start, is_method_call FROM calls";
  const params: string[] = [];
  if (filePaths?.length) {
    const placeholders = filePaths.map(() => "?").join(",");
    sql += ` WHERE file_path IN (${placeholders})`;
    params.push(...filePaths);
  }
  const calls = db.query<CallRowDb>(sql).all(...params);

  const unresolvedRows: UnresolvedCallRow[] = [];
  let resolved = 0;

  for (const call of calls) {
    const { resolved: ok, queue } = resolveOneCall(ctx, db, call);
    if (ok) {
      resolved++;
    } else if (queue) {
      unresolvedRows.push({
        file_path: call.file_path,
        caller_scope: call.caller_scope,
        callee_name: call.callee_name,
        line_start: call.line_start,
        column_start: call.column_start,
        reference_kind: "call",
        created_at: createdAt,
      });
    }
  }

  if (unresolvedRows.length > 0) {
    insertUnresolvedCalls(db, unresolvedRows);
  }

  const residual = db
    .query<{ n: number }>("SELECT COUNT(*) AS n FROM unresolved_calls")
    .get()!.n;
  setMeta(db, META_UNRESOLVED_CALLS_RESIDUAL, String(residual));

  return {
    total: calls.length,
    resolved,
    unresolved: unresolvedRows.length,
  };
}
