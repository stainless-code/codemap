-- Plan 2 slice 2.0 spike: graph-estimated coverage tiers on fixtures/minimal.
-- Run: codemap query --json "$(cat scripts/spike-crap-reachability.sql)" --root fixtures/minimal
-- Expected function/method tier counts: 85% → labyrinth (direct test ref); 40% → complexity-fixture peers (reachable); 0% → rest.
WITH RECURSIVE
test_files(path) AS (
  SELECT DISTINCT f.path
  FROM files f
  WHERE EXISTS (
      SELECT 1
      FROM test_suites ts
      WHERE ts.file_path = f.path
    )
    OR f.path GLOB '*.test.ts'
    OR f.path GLOB '*.test.tsx'
    OR f.path GLOB '*.spec.ts'
    OR f.path GLOB '*.spec.tsx'
    OR f.path GLOB '*.test.js'
    OR f.path GLOB '*.spec.js'
    OR f.path GLOB '*.test.jsx'
    OR f.path GLOB '*.spec.jsx'
),
reachable_files(file_path, depth, visited) AS (
  SELECT path, 0, char(30) || path || char(30)
  FROM test_files
  UNION ALL
  SELECT
    d.to_path,
    rf.depth + 1,
    rf.visited || d.to_path || char(30)
  FROM dependencies d
  JOIN reachable_files rf ON d.from_path = rf.file_path
  WHERE rf.depth < 50
    AND instr(rf.visited, char(30) || d.to_path || char(30)) = 0
),
symbol_tiers AS (
  SELECT
    s.name,
    s.file_path,
    s.complexity,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "references" r
        JOIN bindings b ON b.reference_id = r.id
        JOIN test_files tf ON tf.path = r.file_path
        WHERE b.resolved_symbol_id = s.id
      )
      OR EXISTS (
        SELECT 1
        FROM calls c2
        JOIN test_files tf ON tf.path = c2.file_path
        WHERE c2.callee_symbol_id = s.id
          AND (c2.provenance IS NULL OR c2.provenance = 'ast')
      )
      THEN 85
      WHEN EXISTS (
        SELECT 1
        FROM reachable_files rf
        WHERE rf.file_path = s.file_path
      )
      THEN 40
      ELSE 0
    END AS estimated_pct
  FROM symbols s
  WHERE s.complexity IS NOT NULL
    AND s.kind IN ('function', 'method')
)
SELECT estimated_pct, COUNT(*) AS symbol_count
FROM symbol_tiers
GROUP BY estimated_pct
ORDER BY estimated_pct DESC
