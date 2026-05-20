SELECT file_path, try_line_start, try_line_end, catch_param, catch_logs_only, catch_rethrows
FROM try_catch
WHERE has_catch = 1 AND catch_logs_only = 1
ORDER BY file_path, try_line_start;
