SELECT file_path, name, kind, line_start, line_end, name_column_start, name_column_end, parent_name, signature
FROM symbols
WHERE name = ?
ORDER BY file_path, line_start, name_column_start;
