SELECT
  file_path,
  line_start,
  kind,
  name,
  CASE
    WHEN is_only = 1 THEN 'only'
    WHEN is_skipped = 1 THEN 'skipped'
    WHEN is_todo = 1 THEN 'todo'
  END AS status,
  framework
FROM test_suites
WHERE is_skipped = 1 OR is_only = 1 OR is_todo = 1
ORDER BY status, file_path, line_start;
