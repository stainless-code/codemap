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
WHERE s.is_exported = 1
  AND s.kind = 'function'
ORDER BY coverage_pct ASC, s.file_path ASC, s.line_start ASC
LIMIT 20
