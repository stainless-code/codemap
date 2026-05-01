SELECT name, file_path,
  CASE
    WHEN hooks_used IS NULL OR trim(hooks_used) = '' OR trim(hooks_used) = '[]' THEN 0
    ELSE (length(hooks_used) - length(replace(hooks_used, ',', ''))) + 1
  END AS hook_count
FROM components
ORDER BY hook_count DESC, file_path ASC, name ASC
LIMIT 20
