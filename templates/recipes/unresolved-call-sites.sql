SELECT
  file_path,
  caller_scope,
  callee_name,
  line_start,
  column_start,
  reference_kind,
  created_at
FROM unresolved_calls
ORDER BY file_path, line_start, column_start;
