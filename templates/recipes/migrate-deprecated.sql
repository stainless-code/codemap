WITH params(symbol, replacement, in_file, require_deprecated) AS (
  SELECT ?, ?, ?, ?
),
deprecated_targets AS (
  SELECT s.id, s.name, s.file_path, s.line_start
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p.symbol
    AND (
      p.require_deprecated IS NULL
      OR p.require_deprecated = 0
      OR s.doc_comment LIKE '%@deprecated%'
    )
),
call_rows AS (
  SELECT DISTINCT
    c.file_path,
    c.line_start,
    c.line_start AS line_end,
    p.symbol AS before_pattern,
    p.replacement AS after_pattern,
    'call_site' AS location_kind,
    0 AS chain_depth
  FROM calls c
  CROSS JOIN params p
  WHERE c.callee_name = p.symbol
    AND (c.provenance IS NULL OR c.provenance = 'ast')
    AND (p.in_file IS NULL OR c.file_path LIKE p.in_file || '%')
    AND (
      p.require_deprecated IS NULL
      OR p.require_deprecated = 0
      OR EXISTS (
        SELECT 1
        FROM symbols s
        WHERE s.name = p.symbol
          AND s.doc_comment LIKE '%@deprecated%'
      )
    )
),
import_rows AS (
  SELECT DISTINCT
    i.file_path,
    i.line_number AS line_start,
    i.line_number AS line_end,
    p.symbol AS before_pattern,
    p.replacement AS after_pattern,
    'import_specifier' AS location_kind,
    0 AS chain_depth
  FROM imports i
  JOIN json_each(i.specifiers) spec ON spec.value = p.symbol
  JOIN deprecated_targets t ON t.file_path = i.resolved_path
  CROSS JOIN params p
  WHERE (p.in_file IS NULL OR i.file_path LIKE p.in_file || '%')
    AND instr(p.replacement, '.') = 0
    AND length(trim(p.replacement)) > 0
)
SELECT *
FROM call_rows
UNION ALL
SELECT *
FROM import_rows
ORDER BY file_path, line_start, location_kind;
