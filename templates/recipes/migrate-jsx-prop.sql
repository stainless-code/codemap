WITH params(old_name, new_name, in_file, component_name) AS (
  SELECT ?, ?, ?, ?
),
prop_rows AS (
  SELECT
    e.file_path,
    a.line AS line_start,
    a.line AS line_end,
    CASE
      WHEN a.value_kind IN ('expression', 'string') THEN a.name || '='
      WHEN a.value_kind = 'boolean' THEN ' ' || a.name
      ELSE a.name
    END AS before_pattern,
    CASE
      WHEN a.value_kind IN ('expression', 'string') THEN p.new_name || '='
      WHEN a.value_kind = 'boolean' THEN ' ' || p.new_name
      ELSE p.new_name
    END AS after_pattern,
    'jsx_attribute' AS location_kind,
    0 AS chain_depth
  FROM jsx_attributes a
  JOIN jsx_elements e ON e.id = a.element_id
  CROSS JOIN params p
  WHERE a.name = p.old_name
    AND a.name NOT LIKE '…%'
    AND (p.in_file IS NULL OR e.file_path LIKE p.in_file || '%')
    AND (p.component_name IS NULL OR e.component_name = p.component_name)
)
SELECT *
FROM prop_rows
ORDER BY file_path, line_start, before_pattern;
