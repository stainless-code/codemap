-- High-complexity functions with low test coverage — refactor / test priority.
-- Combines structural (cyclomatic complexity ≥ 10) with runtime (coverage < 50%):
-- the joint signal is "this function has many decision points AND nobody's
-- exercising them" — high risk for hidden bugs on edit.
-- Returns nothing useful until you've run `codemap ingest-coverage <path>`
-- (Istanbul or LCOV) — without coverage data every high-complexity symbol
-- appears regardless of testing.
SELECT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  s.line_end,
  s.complexity,
  ROUND(COALESCE(c.coverage_pct, 0), 1) AS coverage_pct
FROM symbols s
LEFT JOIN coverage c ON c.file_path = s.file_path
                   AND c.name = s.name
                   AND c.line_start = s.line_start
WHERE s.complexity IS NOT NULL
  AND s.complexity >= 10
  AND COALESCE(c.coverage_pct, 0) < 50
ORDER BY s.complexity DESC, s.file_path, s.name
LIMIT 30
