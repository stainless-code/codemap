SELECT file_path, source, line, column_start, column_end, import_id
FROM import_specifiers
WHERE kind = 'side-effect'
ORDER BY file_path, line, column_start;
