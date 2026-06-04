WITH params(in_file, include_type_only) AS (
  SELECT ?, ?
),
unused AS (
  SELECT
    isp.*,
    COUNT(*) OVER (PARTITION BY isp.import_id) AS sib_count
  FROM import_specifiers isp
  CROSS JOIN params p
  WHERE isp.kind IN ('named', 'default')
    AND isp.imported_name != ''
    AND (p.include_type_only != 0 OR isp.is_type_only = 0)
    AND NOT EXISTS (
      SELECT 1
      FROM "references" r
      WHERE r.file_path = isp.file_path
        AND r.name = isp.local_name
        AND r.line_start != isp.line
    )
    AND NOT EXISTS (
      SELECT 1
      FROM exports e
      WHERE e.file_path = isp.file_path
        AND e.name = isp.local_name
    )
    AND (p.in_file IS NULL OR isp.file_path LIKE p.in_file || '%')
),
delete_rows AS (
  SELECT
    u.file_path,
    u.line AS line_start,
    u.line AS line_end,
    CASE
      WHEN u.is_type_only = 1 THEN
        'import { type ' || u.local_name || ' } from "' || u.source || '"'
      WHEN u.kind = 'default' THEN
        'import ' || u.local_name || ' from "' || u.source || '"'
      ELSE
        'import { ' || u.local_name || ' } from "' || u.source || '"'
    END AS before_pattern,
    '' AS after_pattern,
    'import_line' AS location_kind,
    0 AS chain_depth
  FROM unused u
  WHERE u.sib_count = 1
)
SELECT *
FROM delete_rows
ORDER BY file_path, line_start;
