SELECT name, kind, file_path, line_start, signature, doc_comment
FROM symbols
WHERE doc_comment LIKE '%@deprecated%'
ORDER BY file_path ASC, line_start ASC
LIMIT 50
