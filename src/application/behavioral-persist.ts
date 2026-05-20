import type { CodemapDatabase } from "../db";
import type { ParsedDecorator, ParsedJsdocTag } from "../extractors/behavioral";

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
