-- Shared heritage CTEs: templates/recipes-fragments/heritage-edges.sql
WITH RECURSIVE
params(symbol_name, kind_filter, max_depth, file_path) AS (
  SELECT ?, ?, COALESCE(?, 10), ?
),
typed_symbols AS (
  SELECT name, kind, file_path, line_start, signature
  FROM symbols
  WHERE kind IN ('class', 'interface')
),
symbol_clauses AS (
  SELECT
    name,
    kind,
    file_path,
    line_start,
    CASE
      WHEN instr(signature, ' extends ') > 0 THEN trim(
        CASE
          WHEN instr(signature, ' implements ') > 0 THEN substr(
            signature,
            instr(signature, ' extends ') + 9,
            instr(signature, ' implements ') - instr(signature, ' extends ') - 9
          )
          ELSE substr(signature, instr(signature, ' extends ') + 9)
        END
      )
    END AS extends_clause,
    CASE
      WHEN instr(signature, ' implements ') > 0 THEN trim(
        substr(signature, instr(signature, ' implements ') + 12)
      )
    END AS implements_clause
  FROM typed_symbols
),
split_clause(child_name, child_file_path, child_kind, child_line_start, relation, token_raw, rest) AS (
  SELECT
    sc.name,
    sc.file_path,
    sc.kind,
    sc.line_start,
    'extends',
    trim(
      CASE
        WHEN instr(sc.extends_clause, ', ') > 0 THEN substr(
          sc.extends_clause,
          1,
          instr(sc.extends_clause, ', ') - 1
        )
        ELSE sc.extends_clause
      END
    ),
    trim(
      CASE
        WHEN instr(sc.extends_clause, ', ') > 0 THEN substr(
          sc.extends_clause,
          instr(sc.extends_clause, ', ') + 2
        )
        ELSE ''
      END
    )
  FROM symbol_clauses sc
  WHERE sc.extends_clause IS NOT NULL
    AND sc.extends_clause != ''
  UNION ALL
  SELECT
    sc.name,
    sc.file_path,
    sc.kind,
    sc.line_start,
    'implements',
    trim(
      CASE
        WHEN instr(sc.implements_clause, ', ') > 0 THEN substr(
          sc.implements_clause,
          1,
          instr(sc.implements_clause, ', ') - 1
        )
        ELSE sc.implements_clause
      END
    ),
    trim(
      CASE
        WHEN instr(sc.implements_clause, ', ') > 0 THEN substr(
          sc.implements_clause,
          instr(sc.implements_clause, ', ') + 2
        )
        ELSE ''
      END
    )
  FROM symbol_clauses sc
  WHERE sc.implements_clause IS NOT NULL
    AND sc.implements_clause != ''
  UNION ALL
  SELECT
    child_name,
    child_file_path,
    child_kind,
    child_line_start,
    relation,
    trim(
      CASE
        WHEN instr(rest, ', ') > 0 THEN substr(rest, 1, instr(rest, ', ') - 1)
        ELSE rest
      END
    ),
    trim(
      CASE
        WHEN instr(rest, ', ') > 0 THEN substr(rest, instr(rest, ', ') + 2)
        ELSE ''
      END
    )
  FROM split_clause
  WHERE rest != ''
),
heritage_edges AS (
  SELECT
    child_name,
    child_file_path,
    child_kind,
    child_line_start,
    relation,
    trim(
      CASE
        WHEN instr(token_raw, '<') > 0 THEN substr(token_raw, 1, instr(token_raw, '<') - 1)
        ELSE token_raw
      END
    ) AS base_name
  FROM split_clause
  WHERE token_raw != ''
),
resolved_edges AS (
  SELECT child_name, child_file_path, child_kind, child_line_start, relation, base_name, parent_file_path
  FROM (
    SELECT
      he.child_name,
      he.child_file_path,
      he.child_kind,
      he.child_line_start,
      he.relation,
      he.base_name,
      p2.file_path AS parent_file_path,
      ROW_NUMBER() OVER (
        PARTITION BY he.child_name, he.child_file_path, he.relation, he.base_name
        ORDER BY CASE WHEN p2.file_path = he.child_file_path THEN 0 ELSE 1 END, p2.file_path
      ) AS rn
    FROM heritage_edges he
    JOIN typed_symbols p2 ON p2.name = he.base_name
  )
  WHERE rn = 1
),
start_symbols AS (
  SELECT s.name, s.kind, s.file_path, s.line_start
  FROM typed_symbols s
  CROSS JOIN params p
  WHERE s.name = p.symbol_name
    AND (p.kind_filter IS NULL OR p.kind_filter = '' OR s.kind = p.kind_filter)
    AND (p.file_path IS NULL OR p.file_path = '' OR s.file_path = p.file_path)
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
    he.base_name,
    parent.kind,
    parent.file_path,
    parent.line_start,
    he.relation,
    char(30) || he.base_name || char(30) || parent.file_path || char(30)
  FROM start_symbols ss
  JOIN resolved_edges he
    ON he.child_name = ss.name
    AND he.child_file_path = ss.file_path
    AND he.relation = 'extends'
  JOIN typed_symbols parent
    ON parent.name = he.base_name
    AND parent.file_path = he.parent_file_path
  UNION ALL
  SELECT
    a.depth + 1,
    he.base_name,
    parent.kind,
    parent.file_path,
    parent.line_start,
    'extends',
    a.visited || he.base_name || char(30) || parent.file_path || char(30)
  FROM ancestors a
  JOIN resolved_edges he
    ON he.child_name = a.ancestor_name
    AND he.child_file_path = a.ancestor_file_path
    AND he.relation = 'extends'
  JOIN typed_symbols parent
    ON parent.name = he.base_name
    AND parent.file_path = he.parent_file_path
  CROSS JOIN params p
  WHERE a.relation = 'extends'
    AND a.depth < p.max_depth
    AND instr(a.visited, char(30) || he.base_name || char(30) || parent.file_path || char(30)) = 0
),
direct_implements AS (
  SELECT
    1 AS depth,
    he.base_name AS ancestor_name,
    parent.kind AS ancestor_kind,
    parent.file_path AS ancestor_file_path,
    parent.line_start AS ancestor_line_start,
    'implements' AS relation
  FROM start_symbols ss
  JOIN resolved_edges he
    ON he.child_name = ss.name
    AND he.child_file_path = ss.file_path
    AND he.relation = 'implements'
  JOIN typed_symbols parent
    ON parent.name = he.base_name
    AND parent.file_path = he.parent_file_path
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
