SELECT path, line_count, size, language
FROM files
ORDER BY line_count DESC, path ASC
LIMIT 20
