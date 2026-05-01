SELECT to_path, COUNT(*) AS fan_in
FROM dependencies
GROUP BY to_path
ORDER BY fan_in DESC, to_path ASC
LIMIT 15
