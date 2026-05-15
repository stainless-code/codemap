SELECT
  name,
  kind,
  file_path,
  line_start,
  body_line_count,
  complexity,
  nesting_depth
FROM symbols
WHERE nesting_depth IS NOT NULL
  AND nesting_depth >= 4
ORDER BY nesting_depth DESC, complexity DESC
LIMIT 50;
