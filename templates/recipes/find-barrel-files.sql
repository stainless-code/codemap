SELECT path, language, is_barrel, has_side_effects
FROM files
WHERE is_barrel = 1
ORDER BY path;
