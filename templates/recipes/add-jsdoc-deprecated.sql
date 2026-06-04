WITH params(name, replacement, in_file) AS (
  SELECT ?, ?, ?
),
target_symbols AS (
  SELECT s.*
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p.name
    AND (p.in_file IS NULL OR s.file_path LIKE p.in_file || '%')
),
definition_rows AS (
  SELECT
    s.file_path,
    s.line_start,
    s.line_start AS line_end,
    'export function ' || p.name AS before_pattern,
    '/** @deprecated Use ' || p.replacement || ' */' || char(10) || 'export function ' || p.name AS after_pattern,
    'definition' AS location_kind,
    0 AS chain_depth
  FROM target_symbols s
  CROSS JOIN params p
)
SELECT *
FROM definition_rows
ORDER BY file_path, line_start;
