WITH RECURSIVE
params(symbol_name, kind_filter, max_depth, file_path) AS (
  SELECT ?, ?, COALESCE(?, 10), ?
),
start_symbols AS (
  SELECT s.id, s.name, s.kind, s.file_path, s.line_start
  FROM symbols s
  CROSS JOIN params p
  WHERE s.kind IN ('class', 'interface')
    AND s.name = p.symbol_name
    AND (p.kind_filter IS NULL OR p.kind_filter = '' OR s.kind = p.kind_filter)
    AND (p.file_path IS NULL OR p.file_path = '' OR s.file_path = p.file_path)
),
resolved_bases AS (
  SELECT
    th.child_name,
    th.child_file_path,
    th.relation,
    th.base_simple_name,
    parent.kind AS parent_kind,
    parent.file_path AS parent_file_path,
    parent.line_start AS parent_line_start
  FROM type_heritage th
  JOIN symbols parent ON (
    (th.base_symbol_id IS NOT NULL AND parent.id = th.base_symbol_id)
    OR (
      th.base_symbol_id IS NULL
      AND th.base_file_path IS NOT NULL
      AND parent.name = th.base_simple_name
      AND parent.file_path = th.base_file_path
    )
  )
  WHERE th.resolution_kind IN ('same-file', 'imported')
),
ancestors(
  depth,
  ancestor_name,
  ancestor_kind,
  ancestor_file_path,
  ancestor_line_start,
  relation,
  visited
) AS (
  SELECT
    1,
    rb.base_simple_name,
    rb.parent_kind,
    rb.parent_file_path,
    rb.parent_line_start,
    'extends',
    char(30) || rb.base_simple_name || char(30) || rb.parent_file_path || char(30)
  FROM start_symbols ss
  JOIN resolved_bases rb
    ON rb.child_name = ss.name
    AND rb.child_file_path = ss.file_path
    AND rb.relation = 'extends'
  UNION ALL
  SELECT
    a.depth + 1,
    rb.base_simple_name,
    rb.parent_kind,
    rb.parent_file_path,
    rb.parent_line_start,
    'extends',
    a.visited || rb.base_simple_name || char(30) || rb.parent_file_path || char(30)
  FROM ancestors a
  JOIN resolved_bases rb
    ON rb.child_name = a.ancestor_name
    AND rb.child_file_path = a.ancestor_file_path
    AND rb.relation = 'extends'
  CROSS JOIN params p
  WHERE a.relation = 'extends'
    AND a.depth < p.max_depth
    AND instr(
      a.visited,
      char(30) || rb.base_simple_name || char(30) || rb.parent_file_path || char(30)
    ) = 0
),
direct_implements AS (
  SELECT
    1 AS depth,
    rb.base_simple_name AS ancestor_name,
    rb.parent_kind AS ancestor_kind,
    rb.parent_file_path AS ancestor_file_path,
    rb.parent_line_start AS ancestor_line_start,
    'implements' AS relation
  FROM start_symbols ss
  JOIN resolved_bases rb
    ON rb.child_name = ss.name
    AND rb.child_file_path = ss.file_path
    AND rb.relation = 'implements'
)
SELECT
  depth,
  ancestor_name,
  ancestor_kind,
  ancestor_file_path,
  ancestor_line_start,
  relation
FROM ancestors
UNION ALL
SELECT
  depth,
  ancestor_name,
  ancestor_kind,
  ancestor_file_path,
  ancestor_line_start,
  relation
FROM direct_implements
ORDER BY depth ASC, relation ASC, ancestor_name ASC, ancestor_file_path ASC;
