WITH params(in_file, include_type_only) AS (
  SELECT ?, ?
),
specifiers AS (
  SELECT
    isp.*,
    CASE
      WHEN isp.import_id IS NULL THEN 1
      ELSE COUNT(*) OVER (PARTITION BY isp.import_id)
    END AS sib_count,
    CASE
      WHEN isp.import_id IS NULL THEN 1
      ELSE ROW_NUMBER() OVER (PARTITION BY isp.import_id ORDER BY isp.column_start)
    END AS rn,
    (
      CASE
        WHEN isp.is_type_only = 1 THEN 'type '
        ELSE ''
      END
      || CASE
        WHEN isp.imported_name != isp.local_name THEN isp.imported_name || ' as ' || isp.local_name
        ELSE isp.local_name
      END
    ) AS spec_token
  FROM import_specifiers isp
),
unused AS (
  SELECT s.*
  FROM specifiers s
  CROSS JOIN params p
  WHERE s.kind IN ('named', 'default')
    AND s.imported_name != ''
    AND (p.include_type_only != 0 OR s.is_type_only = 0)
    AND NOT EXISTS (
      SELECT 1
      FROM "references" r
      WHERE r.file_path = s.file_path
        AND r.name = s.local_name
        AND r.line_start != s.line
    )
    AND NOT EXISTS (
      SELECT 1
      FROM exports e
      WHERE e.file_path = s.file_path
        AND e.name = s.local_name
    )
    AND (p.in_file IS NULL OR s.file_path LIKE p.in_file || '%')
),
sole_line_rows AS (
  SELECT
    r.file_path,
    r.line AS line_start,
    r.line AS line_end,
    CASE
      WHEN r.is_type_only = 1 THEN
        'import { type ' || r.local_name || ' } from "' || r.source || '"'
      WHEN r.kind = 'default' THEN
        'import ' || r.local_name || ' from "' || r.source || '"'
      ELSE
        'import { ' || r.local_name || ' } from "' || r.source || '"'
    END AS before_pattern,
    '' AS after_pattern,
    'import_line' AS location_kind,
    0 AS chain_depth
  FROM unused r
  WHERE r.sib_count = 1
),
multi_spec_rows AS (
  SELECT
    r.file_path,
    r.line AS line_start,
    r.line AS line_end,
    CASE
      WHEN r.rn = 1 THEN r.spec_token || ', '
      ELSE ', ' || r.spec_token
    END AS before_pattern,
    '' AS after_pattern,
    'import_specifier' AS location_kind,
    0 AS chain_depth
  FROM unused r
  WHERE r.sib_count > 1
)
SELECT *
FROM sole_line_rows
UNION ALL
SELECT *
FROM multi_spec_rows
ORDER BY file_path, line_start, before_pattern;
