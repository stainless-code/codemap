WITH RECURSIVE
params(symbol_name, kind_filter, max_depth, file_path) AS (
  SELECT ?, ?, COALESCE(?, 10), ?
),
base_symbols AS (
  SELECT s.id, s.name, s.file_path
  FROM symbols s
  CROSS JOIN params p
  WHERE s.kind IN ('class', 'interface')
    AND s.name = p.symbol_name
    AND (p.file_path IS NULL OR p.file_path = '' OR s.file_path = p.file_path)
),
resolved_edges AS (
  SELECT
    th.child_name,
    th.child_file_path,
    th.child_kind,
    th.child_line_start,
    th.relation,
    th.base_simple_name,
    th.base_file_path,
    th.base_symbol_id
  FROM type_heritage th
  WHERE th.resolution_kind IN ('same-file', 'imported')
),
descendants(
  depth,
  descendant_name,
  descendant_kind,
  descendant_file_path,
  descendant_line_start,
  relation,
  visited
) AS (
  SELECT
    1,
    re.child_name,
    re.child_kind,
    re.child_file_path,
    re.child_line_start,
    re.relation,
    char(30) || re.child_name || char(30) || re.child_file_path || char(30)
  FROM base_symbols bs
  JOIN resolved_edges re
    ON (
      (re.base_symbol_id IS NOT NULL AND re.base_symbol_id = bs.id)
      OR (
        re.base_symbol_id IS NULL
        AND re.base_simple_name = bs.name
        AND re.base_file_path = bs.file_path
      )
    )
  UNION ALL
  SELECT
    d.depth + 1,
    re.child_name,
    re.child_kind,
    re.child_file_path,
    re.child_line_start,
    'extends',
    d.visited || re.child_name || char(30) || re.child_file_path || char(30)
  FROM descendants d
  JOIN resolved_edges re
    ON re.base_simple_name = d.descendant_name
    AND re.base_file_path = d.descendant_file_path
    AND re.relation = 'extends'
  CROSS JOIN params p
  WHERE d.relation = 'extends'
    AND d.depth < p.max_depth
    AND instr(
      d.visited,
      char(30) || re.child_name || char(30) || re.child_file_path || char(30)
    ) = 0
)
SELECT
  d.depth,
  d.descendant_name,
  d.descendant_kind,
  d.descendant_file_path,
  d.descendant_line_start,
  d.relation
FROM descendants d
CROSS JOIN params p
WHERE (p.kind_filter IS NULL OR p.kind_filter = '' OR d.descendant_kind = p.kind_filter)
  AND (p.file_path IS NULL OR p.file_path = '' OR d.descendant_file_path = p.file_path)
ORDER BY d.depth ASC, d.relation ASC, d.descendant_name ASC, d.descendant_file_path ASC;
