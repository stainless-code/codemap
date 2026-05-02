SELECT file_path, COUNT(*) AS exports
FROM exports
GROUP BY file_path
ORDER BY exports DESC, file_path ASC
LIMIT 20
