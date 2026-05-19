SELECT file_path, caller_name, caller_scope, line_start, column_start, column_end,
       args_count, is_method_call, is_constructor_call, is_optional_chain
FROM calls
WHERE callee_name = ?
ORDER BY file_path, line_start, column_start;
