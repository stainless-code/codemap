SELECT r.file_path, r.name, r.line_start, r.column_start, b.resolution_kind
FROM bindings b
JOIN "references" r ON r.id = b.reference_id
WHERE b.resolution_kind = 're-exported'
ORDER BY r.file_path, r.line_start, r.column_start;
