SELECT
  name,
  kind,
  file_path,
  line_start,
  line_end,
  cognitive_complexity,
  complexity,
  nesting_depth
FROM symbols
WHERE cognitive_complexity IS NOT NULL
  AND cognitive_complexity >= ?
ORDER BY cognitive_complexity DESC, complexity DESC, file_path, name
LIMIT 50;
