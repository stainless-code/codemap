SELECT
  c.file_path,
  c.caller_name,
  c.caller_scope,
  c.callee_name,
  c.line_start,
  c.provenance
FROM calls c
WHERE c.provenance = 'heuristic'
ORDER BY c.file_path, c.line_start;
