SELECT
  file_path,
  owner_name,
  owner_kind,
  position,
  name,
  default_text,
  is_rest,
  is_optional,
  line_start,
  column_start
FROM function_params
WHERE type_text = ?
ORDER BY file_path, owner_name, position;
