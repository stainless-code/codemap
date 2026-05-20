SELECT file_path, caller_scope, awaited_expression, awaited_callee_name, line_start, in_loop, in_try
FROM async_calls
WHERE in_loop = 1
ORDER BY file_path, line_start;
