SELECT
  detail AS env_var,
  COUNT(*) AS uses,
  COUNT(DISTINCT file_path) AS files
FROM runtime_markers
WHERE kind = 'process-env' AND detail IS NOT NULL
GROUP BY detail
ORDER BY uses DESC, env_var;
