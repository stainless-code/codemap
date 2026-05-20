SELECT file_path, target_kind, name, line, column_start, target_symbol_id
FROM decorators
ORDER BY file_path, line, column_start;
