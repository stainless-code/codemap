SELECT
  s.name,
  s.file_path,
  s.line_start,
  COALESCE(c.coverage_pct, 0) AS coverage_pct
FROM symbols s
LEFT JOIN coverage c
  ON  c.file_path  = s.file_path
  AND c.name       = s.name
  AND c.line_start = s.line_start
WHERE s.kind = 'function'
  AND s.is_exported = 1
  AND NOT EXISTS (SELECT 1 FROM calls WHERE callee_name = s.name)
  AND COALESCE(c.coverage_pct, 0) = 0
ORDER BY s.file_path ASC, s.line_start ASC
LIMIT 100
