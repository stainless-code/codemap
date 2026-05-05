SELECT name, kind, file_path, line_start, signature
FROM symbols
WHERE kind = ?
  AND name LIKE ?
ORDER BY file_path, line_start;
