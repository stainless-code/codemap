SELECT file_path, line_start, column_start, source_kind, source_text, resolved_path, in_async_fn
FROM dynamic_imports
ORDER BY file_path, line_start, column_start;
