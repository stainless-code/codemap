SELECT file_path, caller_name, caller_scope, line_start, column_start, column_end
FROM calls
WHERE callee_name = ?
ORDER BY file_path, line_start, column_start;
