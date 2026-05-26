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
    he.child_name,
    he.child_kind,
    he.child_file_path,
    he.child_line_start,
    he.relation,
    char(30) || he.child_name || char(30)
  FROM params p
  JOIN heritage_edges he ON he.base_name = p.symbol_name
  UNION ALL
  SELECT
    d.depth + 1,
    he.child_name,
    he.child_kind,
    he.child_file_path,
    he.child_line_start,
    'extends',
    d.visited || he.child_name || char(30)
  FROM descendants d
  JOIN heritage_edges he
    ON he.base_name = d.descendant_name
    AND he.relation = 'extends'
  CROSS JOIN params p
  WHERE d.relation = 'extends'
    AND d.depth < p.max_depth
    AND instr(d.visited, char(30) || he.child_name || char(30)) = 0
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
WHERE p.kind_filter IS NULL
  OR p.kind_filter = ''
  OR d.descendant_kind = p.kind_filter
ORDER BY d.depth ASC, d.relation ASC, d.descendant_name ASC, d.descendant_file_path ASC;
