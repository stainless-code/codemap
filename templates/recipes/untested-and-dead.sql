-- Honors `// codemap-ignore-{next-line,file} untested-and-dead` via the suppressions LEFT JOIN.
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
LEFT JOIN suppressions sup
  ON  sup.file_path = s.file_path
  AND sup.recipe_id = 'untested-and-dead'
  AND (sup.line_number = 0 OR sup.line_number = s.line_start)
WHERE s.kind = 'function'
  AND s.is_exported = 1
  AND NOT EXISTS (SELECT 1 FROM calls WHERE callee_name = s.name)
  AND COALESCE(c.coverage_pct, 0) = 0
  AND sup.id IS NULL
ORDER BY s.file_path ASC, s.line_start ASC
LIMIT 100
