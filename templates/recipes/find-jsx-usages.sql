SELECT file_path, component_name, line_start, line_end, is_self_closing, is_fragment, is_lowercase, children_count
FROM jsx_elements
WHERE component_name = ?
ORDER BY file_path, line_start, column_start;
