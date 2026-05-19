SELECT path, language, is_barrel, has_side_effects
FROM files
WHERE has_side_effects = 1
ORDER BY path;
