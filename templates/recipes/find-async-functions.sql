SELECT file_path, name, kind, return_type, is_generator
FROM symbols
WHERE is_async = 1
ORDER BY file_path, name;
