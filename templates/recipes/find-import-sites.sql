SELECT file_path, source, line, column_start, column_end, imported_name, local_name, kind, is_type_only
FROM import_specifiers
WHERE imported_name = ?
ORDER BY file_path, line, column_start;
