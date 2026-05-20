import type { CodemapDatabase } from "../db";
import type {
  ParsedAsyncCall,
  ParsedDecorator,
  ParsedJsdocTag,
  ParsedTryCatch,
} from "../extractors/behavioral";

export function insertAsyncCalls(
  db: CodemapDatabase,
  rows: ParsedAsyncCall[],
): void {
  for (const r of rows) {
    db.run(
      `INSERT INTO async_calls (
        file_path, caller_scope, awaited_expression, awaited_callee_name,
        line_start, column_start, in_loop, in_try, scope_local_id
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        r.file_path,
        r.caller_scope,
        r.awaited_expression,
        r.awaited_callee_name,
        r.line_start,
        r.column_start,
        r.in_loop,
        r.in_try,
        r.scope_local_id,
      ],
    );
  }
}

export function insertTryCatchRows(
  db: CodemapDatabase,
  rows: ParsedTryCatch[],
): void {
  for (const r of rows) {
    db.run(
      `INSERT INTO try_catch (
        file_path, containing_scope_local_id, try_line_start, try_line_end,
        has_catch, catch_param, catch_rethrows, catch_logs_only, has_finally
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        r.file_path,
        r.containing_scope_local_id,
        r.try_line_start,
        r.try_line_end,
        r.has_catch,
        r.catch_param,
        r.catch_rethrows,
        r.catch_logs_only,
        r.has_finally,
      ],
    );
  }
}

export function insertDecorators(
  db: CodemapDatabase,
  filePath: string,
  rows: ParsedDecorator[],
): void {
  for (const d of rows) {
    const sym = db
      .query<{ id: number }>(
        `SELECT id FROM symbols
         WHERE file_path = ? AND line_start = ?
         ORDER BY id ASC LIMIT 1`,
      )
      .get(filePath, d.target_line_start);
    db.run(
      `INSERT INTO decorators (
        file_path, target_symbol_id, target_kind, name, line, column_start, args_text
      ) VALUES (?,?,?,?,?,?,?)`,
      [
        d.file_path,
        sym?.id ?? null,
        d.target_kind,
        d.name,
        d.line,
        d.column_start,
        d.args_text,
      ],
    );
  }
}

export function insertJsdocTags(
  db: CodemapDatabase,
  filePath: string,
  rows: ParsedJsdocTag[],
): void {
  for (const t of rows) {
    const sym = db
      .query<{ id: number }>(
        `SELECT id FROM symbols
         WHERE file_path = ? AND name = ? AND line_start = ?
         ORDER BY id ASC LIMIT 1`,
      )
      .get(filePath, t.symbol_name, t.symbol_line_start);
    if (!sym) continue;
    db.run(
      `INSERT INTO jsdoc_tags (symbol_id, tag, name, type_text, description)
       VALUES (?,?,?,?,?)`,
      [sym.id, t.tag, t.name, t.type_text, t.description],
    );
  }
}
