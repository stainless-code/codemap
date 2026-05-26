WITH RECURSIVE
params(symbol_name, kind_filter, max_depth) AS (
  SELECT ?, ?, COALESCE(?, 10)
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
start_symbols AS (
  SELECT s.name, s.kind, s.file_path, s.line_start
  FROM typed_symbols s
  CROSS JOIN params p
  WHERE s.name = p.symbol_name
    AND (p.kind_filter IS NULL OR p.kind_filter = '' OR s.kind = p.kind_filter)
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
    char(30) || he.base_name || char(30)
  FROM start_symbols ss
  JOIN heritage_edges he
    ON he.child_name = ss.name
    AND he.child_file_path = ss.file_path
    AND he.relation = 'extends'
  JOIN typed_symbols parent ON parent.name = he.base_name
  UNION ALL
  SELECT
    a.depth + 1,
    he.base_name,
    parent.kind,
    parent.file_path,
    parent.line_start,
    'extends',
    a.visited || he.base_name || char(30)
  FROM ancestors a
  JOIN heritage_edges he
    ON he.child_name = a.ancestor_name
    AND he.relation = 'extends'
  JOIN typed_symbols parent ON parent.name = he.base_name
  CROSS JOIN params p
  WHERE a.relation = 'extends'
    AND a.depth < p.max_depth
    AND instr(a.visited, char(30) || he.base_name || char(30)) = 0
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
  JOIN heritage_edges he
    ON he.child_name = ss.name
    AND he.child_file_path = ss.file_path
    AND he.relation = 'implements'
  JOIN typed_symbols parent ON parent.name = he.base_name
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
