SELECT file_path, name, kind, is_default, is_re_export, re_export_source, line_start, line_end, column_start, column_end
FROM exports
WHERE name = ?
ORDER BY file_path, line_start, column_start;
