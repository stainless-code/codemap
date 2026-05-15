SELECT
  file_path,
  framework,
  COUNT(*) FILTER (WHERE kind = 'describe') AS describes,
  COUNT(*) FILTER (WHERE kind IN ('it','test')) AS tests,
  SUM(is_skipped) AS skipped,
  SUM(is_only) AS only_marks,
  SUM(is_todo) AS todos
FROM test_suites
GROUP BY file_path, framework
ORDER BY tests DESC;
