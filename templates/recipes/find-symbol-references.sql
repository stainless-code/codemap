SELECT
  r.file_path,
  r.line_start,
  r.column_start,
  r.column_end,
  r.kind,
  r.is_write,
  b.resolution_kind,
  sc.kind AS scope_kind,
  sc.owner_symbol_name AS scope_owner
FROM bindings b
JOIN "references" r ON r.id = b.reference_id
JOIN symbols s ON s.id = b.resolved_symbol_id
LEFT JOIN scopes sc
  ON sc.file_path = r.file_path AND sc.local_id = r.scope_local_id
WHERE s.name = ? AND s.file_path = ?
ORDER BY r.file_path, r.line_start, r.column_start;
