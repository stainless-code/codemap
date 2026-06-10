-- Static dead exports with zero (or unmeasured) coverage — adds `confidence` over `untested-and-dead`.
-- Honors `// codemap-ignore-{next-line,file}` for `untested-and-dead` or `coverage-confirmed-dead`.
SELECT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  COALESCE(c.coverage_pct, 0) AS coverage_pct,
  (
    SELECT COUNT(*)
    FROM calls
    WHERE callee_name = s.name
      AND (provenance IS NULL OR provenance = 'ast')
  ) AS caller_count,
  CASE
    WHEN c.coverage_pct IS NOT NULL AND c.coverage_pct = 0 THEN 'high'
    ELSE 'medium'
  END AS confidence,
  CASE
    WHEN c.coverage_pct IS NOT NULL AND c.coverage_pct = 0
    THEN 'no_callers_and_zero_coverage'
    ELSE 'no_callers_and_coverage_unmeasured'
  END AS reason
FROM symbols s
LEFT JOIN coverage c
  ON c.file_path = s.file_path
  AND c.name = s.name
  AND c.line_start = s.line_start
LEFT JOIN suppressions sup
  ON sup.file_path = s.file_path
  AND sup.recipe_id IN ('untested-and-dead', 'coverage-confirmed-dead')
  AND (sup.line_number = 0 OR sup.line_number = s.line_start)
WHERE s.kind = 'function'
  AND s.is_exported = 1
  AND NOT EXISTS (
    SELECT 1
    FROM calls
    WHERE callee_name = s.name
      AND (provenance IS NULL OR provenance = 'ast')
  )
  AND COALESCE(c.coverage_pct, 0) = 0
  AND sup.id IS NULL
ORDER BY confidence DESC, s.file_path ASC, s.line_start ASC
LIMIT 100
