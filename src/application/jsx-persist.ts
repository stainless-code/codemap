import type { CodemapDatabase } from "../db";
import type { ParsedJsxAttribute, ParsedJsxElement } from "../extractors/jsx";

export function persistJsxElementsAndAttributes(
  db: CodemapDatabase,
  elements: ParsedJsxElement[],
  attributes: ParsedJsxAttribute[],
): void {
  if (!elements.length) return;
  const idMap = new Map<number, number>();
  for (const el of elements) {
    db.run(
      `INSERT INTO jsx_elements (
        file_path, component_name, line_start, line_end, column_start, column_end,
        is_self_closing, is_fragment, namespace_prefix, parent_element_id,
        children_count, is_lowercase
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        el.file_path,
        el.component_name,
        el.line_start,
        el.line_end,
        el.column_start,
        el.column_end,
        el.is_self_closing,
        el.is_fragment,
        el.namespace_prefix,
        null,
        el.children_count,
        el.is_lowercase,
      ],
    );
    idMap.set(
      el._local_id,
      db.query<{ id: number }>("SELECT last_insert_rowid() AS id").get()!.id,
    );
  }
  for (const el of elements) {
    if (el._parent_local_id == null) continue;
    const id = idMap.get(el._local_id);
    const parentId = idMap.get(el._parent_local_id);
    if (id != null && parentId != null) {
      db.run("UPDATE jsx_elements SET parent_element_id = ? WHERE id = ?", [
        parentId,
        id,
      ]);
    }
  }
  for (const attr of attributes) {
    const elementId = idMap.get(attr.element_local_id);
    if (elementId == null) continue;
    db.run(
      `INSERT INTO jsx_attributes (
        element_id, name, line, column_start, column_end, value_kind, value_text
      ) VALUES (?,?,?,?,?,?,?)`,
      [
        elementId,
        attr.name,
        attr.line,
        attr.column_start,
        attr.column_end,
        attr.value_kind,
        attr.value_text,
      ],
    );
  }
}
