WITH params(from_kind, to_kind, in_file) AS (
  SELECT ?, ?, ?
),
marker_rows AS (
  SELECT
    m.file_path,
    m.line_number AS line_start,
    m.line_number AS line_end,
    p.from_kind AS before_pattern,
    p.to_kind AS after_pattern,
    'marker' AS location_kind,
    0 AS chain_depth
  FROM markers m
  CROSS JOIN params p
  WHERE m.kind = p.from_kind
    AND m.content LIKE '%' || p.from_kind || '%'
    AND (p.in_file IS NULL OR m.file_path LIKE p.in_file || '%')
)
SELECT *
FROM marker_rows
ORDER BY file_path, line_start;
