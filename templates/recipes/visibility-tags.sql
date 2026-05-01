SELECT name, kind, visibility, file_path, line_start, signature, doc_comment
FROM symbols
WHERE visibility IS NOT NULL
ORDER BY file_path ASC, line_start ASC
LIMIT 100
