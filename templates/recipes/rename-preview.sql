WITH params(old_name, new_name, kind_filter, in_file, include_tests, include_re_exports, define_in) AS (
  SELECT ?, ?, ?, ?, ?, ?, ?
),
-- target_symbols intentionally does NOT filter by `in_file`. `in_file` narrows
-- the OUTPUT rows (definition / import call sites whose own `file_path` is
-- under the prefix), so when a symbol is defined outside the scope but
-- imported inside it the import rows still surface for review.
target_symbols AS (
  SELECT s.*
  FROM symbols s, params p
  WHERE s.name = p.old_name
    AND (p.define_in IS NULL OR s.file_path = p.define_in)
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
    AND (
      p.define_in IS NULL
      OR EXISTS (
        SELECT 1
        FROM "references" r
        JOIN bindings b ON b.reference_id = r.id
        WHERE r.file_path = c.file_path
          AND r.line_start = c.line_start
          AND r.name = p.old_name
          AND b.resolved_symbol_id IN (SELECT id FROM target_symbols)
      )
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
),
-- Imports that resolve to a barrel re-exporting the target (consumer names the
-- symbol in specifiers but resolved_path is the barrel file, not the defining module).
barrel_import_rows AS (
  SELECT DISTINCT
    i.file_path,
    i.line_number AS line_start,
    i.line_number AS line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    'barrel_import_specifier' AS location_kind,
    rec.hops AS chain_depth
  FROM imports i
  JOIN json_each(i.specifiers) spec
  JOIN re_export_chains rec
    ON rec.from_file = i.resolved_path AND rec.from_name = spec.value
  JOIN target_symbols s
    ON rec.to_file = s.file_path AND rec.to_name = s.name
  CROSS JOIN params p
  WHERE spec.value = p.old_name
    AND (p.include_re_exports IS NULL OR p.include_re_exports != 0)
    AND i.resolved_path IS NOT NULL
    AND i.resolved_path != s.file_path
    AND (p.in_file IS NULL OR i.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (i.file_path NOT LIKE '%test.%' AND i.file_path NOT LIKE '%spec.%')
    )
),
-- Binding-resolved identifier sites not already covered by definition / call CTEs.
reference_rows AS (
  SELECT DISTINCT
    r.file_path,
    r.line_start,
    r.line_start AS line_end,
    p.old_name AS before_pattern,
    p.new_name AS after_pattern,
    'reference' AS location_kind,
    0 AS chain_depth
  FROM bindings b
  JOIN "references" r ON r.id = b.reference_id
  JOIN target_symbols s ON s.id = b.resolved_symbol_id
  CROSS JOIN params p
  WHERE (p.in_file IS NULL OR r.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (r.file_path NOT LIKE '%test.%' AND r.file_path NOT LIKE '%spec.%')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM target_symbols s2
      WHERE s2.id = s.id
        AND s2.file_path = r.file_path
        AND r.line_start BETWEEN s2.line_start AND s2.line_end
    )
    AND NOT EXISTS (
      SELECT 1
      FROM calls c
      WHERE c.file_path = r.file_path
        AND c.line_start = r.line_start
        AND c.callee_name = p.old_name
        AND (c.provenance IS NULL OR c.provenance = 'ast')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM imports i2
      JOIN json_each(i2.specifiers) spec2 ON spec2.value = p.old_name
      WHERE i2.file_path = r.file_path
        AND i2.line_number = r.line_start
    )
),
-- jsx_elements covers member/namespaced tags where references suppress JSXMemberExpression.
jsx_element_rows AS (
  SELECT DISTINCT
    j.file_path,
    j.line_start,
    j.line_start AS line_end,
    CASE
      WHEN j.namespace_prefix IS NOT NULL AND j.namespace_prefix != '' THEN
        j.namespace_prefix || '.' || p.old_name
      ELSE
        p.old_name
    END AS before_pattern,
    CASE
      WHEN j.namespace_prefix IS NOT NULL AND j.namespace_prefix != '' THEN
        j.namespace_prefix || '.' || p.new_name
      ELSE
        p.new_name
    END AS after_pattern,
    'jsx_element' AS location_kind,
    0 AS chain_depth
  FROM jsx_elements j
  CROSS JOIN params p
  WHERE j.component_name = p.old_name
    AND j.is_fragment = 0
    AND j.is_lowercase = 0
    AND (p.in_file IS NULL OR j.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (j.file_path NOT LIKE '%test.%' AND j.file_path NOT LIKE '%spec.%')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM bindings b
      JOIN "references" r ON r.id = b.reference_id
      JOIN target_symbols s ON s.id = b.resolved_symbol_id
      WHERE r.file_path = j.file_path
        AND r.line_start = j.line_start
        AND r.name = p.old_name
        AND r.kind = 'jsx'
    )
),
jsx_closing_rows AS (
  SELECT DISTINCT
    j.file_path,
    j.line_end AS line_start,
    j.line_end AS line_end,
    '</' || CASE
      WHEN j.namespace_prefix IS NOT NULL AND j.namespace_prefix != '' THEN
        j.namespace_prefix || '.' || p.old_name
      ELSE
        p.old_name
    END AS before_pattern,
    '</' || CASE
      WHEN j.namespace_prefix IS NOT NULL AND j.namespace_prefix != '' THEN
        j.namespace_prefix || '.' || p.new_name
      ELSE
        p.new_name
    END AS after_pattern,
    'jsx_closing' AS location_kind,
    0 AS chain_depth
  FROM jsx_elements j
  CROSS JOIN params p
  WHERE j.component_name = p.old_name
    AND j.is_fragment = 0
    AND j.is_lowercase = 0
    AND j.is_self_closing = 0
    AND j.line_end > j.line_start
    AND (p.in_file IS NULL OR j.file_path LIKE p.in_file || '%')
    AND (
      p.include_tests
      OR (j.file_path NOT LIKE '%test.%' AND j.file_path NOT LIKE '%spec.%')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM bindings b
      JOIN "references" r ON r.id = b.reference_id
      JOIN target_symbols s ON s.id = b.resolved_symbol_id
      WHERE r.file_path = j.file_path
        AND r.line_start = j.line_end
        AND r.name = p.old_name
        AND r.kind = 'jsx'
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
UNION ALL
SELECT *
FROM barrel_import_rows
UNION ALL
SELECT *
FROM reference_rows
UNION ALL
SELECT *
FROM jsx_element_rows
UNION ALL
SELECT *
FROM jsx_closing_rows
ORDER BY file_path, line_start, location_kind;
