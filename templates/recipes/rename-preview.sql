WITH params(old_name, new_name, kind_filter, in_file, include_tests, include_re_exports) AS (
  SELECT ?, ?, ?, ?, ?, ?
),
-- target_symbols intentionally does NOT filter by `in_file`. `in_file` narrows
-- the OUTPUT rows (definition / import call sites whose own `file_path` is
-- under the prefix), so when a symbol is defined outside the scope but
-- imported inside it the import rows still surface for review.
target_symbols AS (
  SELECT s.*
  FROM symbols s, params p
  WHERE s.name = p.old_name
    AND (p.kind_filter IS NULL OR s.kind = p.kind_filter)
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
  WHERE p.in_file IS NULL OR s.file_path LIKE p.in_file || '%'
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
),
call_rows AS (
  SELECT DISTINCT
    c.file_path,
    c.line_start,
    c.line_start AS line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    'call_site' AS location_kind,
    0 AS chain_depth
  FROM calls c
  CROSS JOIN params p
  WHERE c.callee_name = p.old_name
    AND (c.provenance IS NULL OR c.provenance = 'ast')
    AND (p.in_file IS NULL OR c.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (c.file_path NOT LIKE '%test.%' AND c.file_path NOT LIKE '%spec.%')
    )
),
re_export_rows AS (
  SELECT DISTINCT
    e.file_path,
    e.line_start,
    e.line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    're_export' AS location_kind,
    rec.hops AS chain_depth
  FROM exports e
  JOIN re_export_chains rec
    ON rec.from_file = e.file_path AND rec.from_name = e.name
  JOIN target_symbols s
    ON rec.to_file = s.file_path AND rec.to_name = s.name
  CROSS JOIN params p
  WHERE (p.include_re_exports IS NULL OR p.include_re_exports != 0)
    AND (p.in_file IS NULL OR e.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (e.file_path NOT LIKE '%test.%' AND e.file_path NOT LIKE '%spec.%')
    )
)
SELECT *
FROM definition_rows
UNION ALL
SELECT *
FROM import_rows
UNION ALL
SELECT *
FROM call_rows
UNION ALL
SELECT *
FROM re_export_rows
ORDER BY file_path, line_start, location_kind;
