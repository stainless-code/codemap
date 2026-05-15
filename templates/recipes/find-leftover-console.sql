SELECT
  file_path,
  line_start,
  column_start,
  detail AS method
FROM runtime_markers
WHERE kind = 'console'
ORDER BY file_path, line_start;
