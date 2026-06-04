/**
 * Post-index heuristic call edges (EventEmitter, JSX composition, setState→render).
 * Tagged `provenance = 'heuristic'` so Moat-A recipes exclude them by default.
 */
import { deleteHeuristicCalls, insertCalls } from "../db";
import type { CallRow, CodemapDatabase } from "../db";

/** Cap synthetic edges per file to limit false-positive fan-out. */
const MAX_HEURISTIC_EDGES_PER_FILE = 32;

const AST_CALL_FILTER = "(provenance IS NULL OR provenance = 'ast')";

interface JsxEdgeRow {
  file_path: string;
  caller_name: string;
  caller_scope: string;
  callee_name: string;
  line_start: number;
  column_start: number;
  column_end: number;
}

export interface SynthesizeCallbackCallsResult {
  jsxEdges: number;
  skippedDuplicate: number;
}

export function synthesizeCallbackCalls(
  db: CodemapDatabase,
  options?: { filePaths?: readonly string[] },
): SynthesizeCallbackCallsResult {
  deleteHeuristicCalls(db, options?.filePaths);

  const jsxRows = loadJsxComponentEdges(db, options?.filePaths);
  const deduped = dedupeJsxEdges(jsxRows, db);
  if (deduped.insert.length > 0) {
    insertCalls(db, deduped.insert);
  }

  return {
    jsxEdges: deduped.insert.length,
    skippedDuplicate: deduped.skippedDuplicate,
  };
}

function loadJsxComponentEdges(
  db: CodemapDatabase,
  filePaths?: readonly string[],
): JsxEdgeRow[] {
  const fileClause =
    filePaths && filePaths.length > 0
      ? `AND comp.file_path IN (${filePaths.map(() => "?").join(",")})`
      : "";
  const sql = `
    SELECT
      comp.file_path AS file_path,
      comp.name AS caller_name,
      comp.name AS caller_scope,
      je.component_name AS callee_name,
      je.line_start AS line_start,
      je.column_start AS column_start,
      je.column_end AS column_end
    FROM components comp
    JOIN symbols host ON host.file_path = comp.file_path
      AND host.name = comp.name
      AND host.kind IN ('function', 'const', 'class')
    JOIN jsx_elements je ON je.file_path = comp.file_path
      AND je.line_start >= host.line_start
      AND je.line_start <= host.line_end
      AND je.is_lowercase = 0
      AND je.is_fragment = 0
      AND je.component_name != comp.name
    JOIN components child_comp ON child_comp.name = je.component_name
    WHERE 1=1
    ${fileClause}
    ORDER BY comp.file_path, je.line_start
  `;
  return db.query<JsxEdgeRow>(sql).all(...(filePaths ?? [])) as JsxEdgeRow[];
}

function dedupeJsxEdges(
  rows: JsxEdgeRow[],
  db: CodemapDatabase,
): { insert: CallRow[]; skippedDuplicate: number } {
  const perFile = new Map<string, number>();
  const insert: CallRow[] = [];
  let skippedDuplicate = 0;

  for (const row of rows) {
    const count = perFile.get(row.file_path) ?? 0;
    if (count >= MAX_HEURISTIC_EDGES_PER_FILE) continue;

    const edgeKey = `${row.file_path}\0${row.caller_scope}\0${row.callee_name}`;
    if (
      insert.some(
        (c) =>
          `${c.file_path}\0${c.caller_scope}\0${c.callee_name}` === edgeKey,
      )
    ) {
      continue;
    }

    if (astCallExists(db, row)) {
      skippedDuplicate++;
      continue;
    }

    insert.push({
      file_path: row.file_path,
      caller_name: row.caller_name,
      caller_scope: row.caller_scope,
      callee_name: row.callee_name,
      line_start: row.line_start,
      column_start: row.column_start,
      column_end: row.column_end,
      is_method_call: 0,
      is_constructor_call: 0,
      is_optional_chain: 0,
      provenance: "heuristic",
    });
    perFile.set(row.file_path, count + 1);
  }

  return { insert, skippedDuplicate };
}

function astCallExists(db: CodemapDatabase, row: JsxEdgeRow): boolean {
  const hit = db
    .query<{ n: number }>(
      `SELECT 1 AS n FROM calls
       WHERE file_path = ? AND caller_scope = ? AND callee_name = ?
         AND ${AST_CALL_FILTER}
       LIMIT 1`,
    )
    .get(row.file_path, row.caller_scope, row.callee_name);
  return hit != null;
}
