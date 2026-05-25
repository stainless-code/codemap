WITH RECURSIVE
params(name, max_depth, kind_filter) AS (
  SELECT ?, COALESCE(?, 1), ?
),
call_walk(sym, depth, path) AS (
  SELECT p.name, 0, char(30) || p.name || char(30)
  FROM params p
  UNION ALL
  SELECT c.callee_name, cw.depth + 1, cw.path || c.callee_name || char(30)
  FROM calls c
  JOIN call_walk cw ON c.caller_name = cw.sym
  CROSS JOIN params p
  WHERE cw.depth < p.max_depth
    AND instr(cw.path, char(30) || c.callee_name || char(30)) = 0
  UNION ALL
  SELECT c.caller_name, cw.depth + 1, cw.path || c.caller_name || char(30)
  FROM calls c
  JOIN call_walk cw ON c.callee_name = cw.sym
  CROSS JOIN params p
  WHERE cw.depth < p.max_depth
    AND instr(cw.path, char(30) || c.caller_name || char(30)) = 0
),
call_neighbors AS (
  SELECT
    cw.sym,
    cw.depth,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM calls c
        CROSS JOIN params p
        WHERE c.caller_name = p.name
          AND c.callee_name = cw.sym
          AND cw.depth = 1
      ) THEN 'callee'
      WHEN EXISTS (
        SELECT 1
        FROM calls c
        CROSS JOIN params p
        WHERE c.callee_name = p.name
          AND c.caller_name = cw.sym
          AND cw.depth = 1
      ) THEN 'caller'
      ELSE 'indirect'
    END AS edge,
    'calls' AS via
  FROM call_walk cw
  CROSS JOIN params p
  WHERE cw.depth > 0
    AND cw.depth <= p.max_depth
),
seed_files AS (
  SELECT DISTINCT s.file_path
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p.name
),
dep_neighbors AS (
  SELECT
    e.name AS sym,
    1 AS depth,
    'depends_on' AS edge,
    'dependencies' AS via
  FROM exports e
  JOIN dependencies d ON d.to_path = e.file_path
  JOIN seed_files sf ON d.from_path = sf.file_path
  CROSS JOIN params p
  WHERE p.max_depth >= 1
  UNION
  SELECT
    e.name,
    1,
    'depended_on_by',
    'dependencies'
  FROM exports e
  JOIN dependencies d ON d.from_path = e.file_path
  JOIN seed_files sf ON d.to_path = sf.file_path
  CROSS JOIN params p
  WHERE p.max_depth >= 1
),
neighbors AS (
  SELECT sym, depth, edge, via FROM call_neighbors
  UNION ALL
  SELECT sym, depth, edge, via FROM dep_neighbors
)
SELECT DISTINCT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  s.line_end,
  s.signature,
  n.edge,
  n.depth,
  n.via
FROM neighbors n
JOIN symbols s ON s.name = n.sym
CROSS JOIN params p
WHERE (p.kind_filter IS NULL OR s.kind = p.kind_filter)
ORDER BY n.depth ASC, n.edge ASC, s.file_path ASC, s.line_start ASC;
