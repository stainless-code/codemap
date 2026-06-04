WITH params(old_source, new_source, in_file) AS (
  SELECT ?, ?, ?
),
import_rows AS (
  SELECT
    i.file_path,
    i.line_number AS line_start,
    i.line_number AS line_end,
    i.source AS before_pattern,
    p.new_source AS after_pattern,
    'import_source' AS location_kind,
    0 AS chain_depth
  FROM imports i
  CROSS JOIN params p
  WHERE i.source = p.old_source
    AND (p.in_file IS NULL OR i.file_path LIKE p.in_file || '%')
)
SELECT *
FROM import_rows
ORDER BY file_path, line_start;
