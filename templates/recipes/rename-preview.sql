WITH params(old_name, new_name, kind_filter, in_file, include_tests, include_re_exports) AS (
  SELECT ?, ?, ?, ?, ?, ?
),
target_symbols AS (
  SELECT s.*
  FROM symbols s, params p
  WHERE s.name = p.old_name
    AND (p.kind_filter IS NULL OR s.kind = p.kind_filter)
    AND (p.in_file IS NULL OR s.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (s.file_path NOT LIKE '%test.%' AND s.file_path NOT LIKE '%spec.%')
    )
),
definition_rows AS (
  SELECT
    s.file_path,
    s.line_start,
    s.line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    'definition' AS location_kind,
    0 AS chain_depth
  FROM target_symbols s, params p
),
import_rows AS (
  SELECT DISTINCT
    i.file_path,
    i.line_number AS line_start,
    i.line_number AS line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    'import_specifier' AS location_kind,
    0 AS chain_depth
  FROM imports i
  JOIN target_symbols s ON i.resolved_path = s.file_path
  JOIN json_each(i.specifiers) spec ON spec.value = s.name
  CROSS JOIN params p
  WHERE (p.in_file IS NULL OR i.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (i.file_path NOT LIKE '%test.%' AND i.file_path NOT LIKE '%spec.%')
    )
)
SELECT *
FROM definition_rows
UNION ALL
SELECT *
FROM import_rows
ORDER BY file_path, line_start, location_kind;
