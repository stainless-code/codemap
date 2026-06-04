WITH RECURSIVE
params("from", "to", max_depth, via_mode) AS (
  SELECT ?, ?, COALESCE(?, 10), COALESCE(?, 'calls')
),
call_paths(hop, current, visited, edges) AS (
  SELECT
    1,
    c.callee_name,
    char(30) || p."from" || char(30) || c.callee_name || char(30),
    json_array(
      json_object(
        'file_path',
        c.file_path,
        'caller_name',
        c.caller_name,
        'callee_name',
        c.callee_name,
        'line_start',
        c.line_start,
        'hop',
        1,
        'via',
        'calls'
      )
    )
  FROM calls c
  CROSS JOIN params p
  WHERE c.caller_name = p."from"
    AND (c.provenance IS NULL OR c.provenance = 'ast')
    AND (p.via_mode = 'calls' OR p.via_mode = 'all')
  UNION ALL
  SELECT
    cp.hop + 1,
    c.callee_name,
    cp.visited || c.callee_name || char(30),
    json_insert(
      cp.edges,
      '$[#]',
      json_object(
        'file_path',
        c.file_path,
        'caller_name',
        c.caller_name,
        'callee_name',
        c.callee_name,
        'line_start',
        c.line_start,
        'hop',
        cp.hop + 1,
        'via',
        'calls'
      )
    )
  FROM calls c
  JOIN call_paths cp ON c.caller_name = cp.current
  CROSS JOIN params p
  WHERE (c.provenance IS NULL OR c.provenance = 'ast')
    AND cp.hop < p.max_depth
    AND cp.current != p."to"
    AND (p.via_mode = 'calls' OR p.via_mode = 'all')
    AND instr(cp.visited, char(30) || c.callee_name || char(30)) = 0
),
call_best AS (
  SELECT cp.edges
  FROM call_paths cp
  CROSS JOIN params p
  WHERE cp.current = p."to"
  ORDER BY cp.hop ASC, cp.visited ASC
  LIMIT 1
),
from_files AS (
  SELECT DISTINCT s.file_path
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p."from"
),
to_files AS (
  SELECT DISTINCT s.file_path
  FROM symbols s
  CROSS JOIN params p
  WHERE s.name = p."to"
),
dep_paths(hop, current, visited, edges) AS (
  SELECT
    1,
    d.to_path,
    char(30) || ff.file_path || char(30) || d.to_path || char(30),
    json_array(
      json_object(
        'file_path',
        d.from_path,
        'caller_name',
        d.from_path,
        'callee_name',
        d.to_path,
        'line_start',
        0,
        'hop',
        1,
        'via',
        'dependencies'
      )
    )
  FROM dependencies d
  JOIN from_files ff ON d.from_path = ff.file_path
  CROSS JOIN params p
  WHERE p.via_mode = 'dependencies' OR p.via_mode = 'all'
  UNION ALL
  SELECT
    dp.hop + 1,
    d.to_path,
    dp.visited || d.to_path || char(30),
    json_insert(
      dp.edges,
      '$[#]',
      json_object(
        'file_path',
        d.from_path,
        'caller_name',
        d.from_path,
        'callee_name',
        d.to_path,
        'line_start',
        0,
        'hop',
        dp.hop + 1,
        'via',
        'dependencies'
      )
    )
  FROM dependencies d
  JOIN dep_paths dp ON d.from_path = dp.current
  CROSS JOIN params p
  WHERE dp.hop < p.max_depth
    AND (p.via_mode = 'dependencies' OR p.via_mode = 'all')
    AND instr(dp.visited, char(30) || d.to_path || char(30)) = 0
    AND NOT EXISTS (SELECT 1 FROM to_files tf WHERE tf.file_path = dp.current)
),
dep_best AS (
  SELECT dp.edges
  FROM dep_paths dp
  JOIN to_files tf ON dp.current = tf.file_path
  CROSS JOIN params p
  WHERE p.via_mode = 'dependencies' OR p.via_mode = 'all'
  ORDER BY dp.hop ASC, dp.visited ASC
  LIMIT 1
),
chosen AS (
  SELECT edges
  FROM call_best
  UNION ALL
  SELECT edges
  FROM dep_best
  WHERE NOT EXISTS (SELECT 1 FROM call_best)
)
SELECT
  json_extract(e.value, '$.file_path') AS file_path,
  json_extract(e.value, '$.caller_name') AS caller_name,
  json_extract(e.value, '$.callee_name') AS callee_name,
  CAST(json_extract(e.value, '$.line_start') AS INTEGER) AS line_start,
  CAST(json_extract(e.value, '$.hop') AS INTEGER) AS hop,
  json_extract(e.value, '$.via') AS via
FROM (
  SELECT edges
  FROM chosen
  LIMIT 1
) best,
json_each(best.edges) e
ORDER BY CAST(e.key AS INTEGER);
