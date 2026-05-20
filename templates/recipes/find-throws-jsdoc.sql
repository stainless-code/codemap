SELECT s.file_path, s.name, s.line_start, t.tag, t.type_text, t.description
FROM symbols s
JOIN jsdoc_tags t ON t.symbol_id = s.id
WHERE t.tag = '@throws'
ORDER BY s.file_path, s.line_start;
