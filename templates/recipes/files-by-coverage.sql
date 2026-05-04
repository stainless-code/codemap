SELECT
  file_path,
  SUM(hit_statements)   AS hit_statements,
  SUM(total_statements) AS total_statements,
  CASE
    WHEN SUM(total_statements) = 0 THEN NULL
    ELSE ROUND(100.0 * SUM(hit_statements) / SUM(total_statements), 2)
  END AS coverage_pct
FROM coverage
GROUP BY file_path
ORDER BY coverage_pct ASC NULLS LAST, file_path ASC
LIMIT 100
