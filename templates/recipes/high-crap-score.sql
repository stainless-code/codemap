-- CRAP score (complexity × undertest risk) with measured or graph-estimated coverage.
-- Formula: CC² × (1 - effective_coverage/100)³ + CC  (CC = symbols.complexity).
-- Without ingest-coverage, effective coverage uses static tiers from test reachability:
-- 85% direct reference from a test file; 40% file dependency-reachable from tests; 0% otherwise.
WITH RECURSIVE
params(min_crap) AS (
  SELECT COALESCE(?, 30)
),
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
effective AS (
  SELECT
    s.name,
    s.kind,
    s.file_path,
    s.line_start,
    s.line_end,
    s.complexity,
    ROUND(
      COALESCE(
        c.coverage_pct,
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
          THEN 85.0
          WHEN EXISTS (
            SELECT 1
            FROM reachable_files rf
            WHERE rf.file_path = s.file_path
          )
          THEN 40.0
          ELSE 0.0
        END
      ),
      1
    ) AS effective_coverage_pct,
    CASE
      WHEN c.coverage_pct IS NOT NULL THEN 'measured'
      ELSE 'estimated'
    END AS coverage_source
  FROM symbols s
  LEFT JOIN coverage c
    ON c.file_path = s.file_path
   AND c.name = s.name
   AND c.line_start = s.line_start
  WHERE s.complexity IS NOT NULL
),
scored AS (
  SELECT
    e.*,
    ROUND(
      e.complexity * e.complexity * POWER(1 - e.effective_coverage_pct / 100.0, 3)
      + e.complexity,
      2
    ) AS crap_score
  FROM effective e
)
SELECT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  s.line_end,
  s.complexity,
  s.effective_coverage_pct,
  s.coverage_source,
  s.crap_score
FROM scored s
CROSS JOIN params p
WHERE s.crap_score >= p.min_crap
ORDER BY s.crap_score DESC, s.complexity DESC, s.file_path, s.name
LIMIT 50
