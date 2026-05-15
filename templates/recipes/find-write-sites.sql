SELECT
  r.file_path,
  r.name,
  r.line_start,
  r.column_start,
  r.column_end,
  r.kind,
  s.kind AS scope_kind,
  s.owner_symbol_name AS scope_owner
FROM "references" r
LEFT JOIN scopes s
  ON s.file_path = r.file_path AND s.local_id = r.scope_local_id
WHERE r.is_write = 1
  AND r.name = ?
ORDER BY r.file_path, r.line_start, r.column_start;
