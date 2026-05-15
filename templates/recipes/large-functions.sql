SELECT
  name,
  kind,
  file_path,
  line_start,
  line_end,
  body_line_count,
  param_count,
  complexity,
  nesting_depth
FROM symbols
WHERE body_line_count IS NOT NULL
  AND body_line_count >= 50
ORDER BY body_line_count DESC
LIMIT 50;
