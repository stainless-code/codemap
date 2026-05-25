WITH RECURSIVE
params(changed_raw, test_glob, max_depth) AS (
  SELECT ?, ?, COALESCE(?, 50)
),
split(value, remainder) AS (
  SELECT
    CASE
      WHEN instr(p.changed_raw, char(30)) > 0 THEN substr(
        p.changed_raw,
        1,
        instr(p.changed_raw, char(30)) - 1
      )
      ELSE p.changed_raw
    END,
    CASE
      WHEN instr(p.changed_raw, char(30)) > 0 THEN substr(
        p.changed_raw,
        instr(p.changed_raw, char(30)) + 1
      )
      ELSE ''
    END
  FROM params p
  UNION ALL
  SELECT
    CASE
      WHEN instr(s.remainder, char(30)) > 0 THEN substr(
        s.remainder,
        1,
        instr(s.remainder, char(30)) - 1
      )
      ELSE s.remainder
    END,
    CASE
      WHEN instr(s.remainder, char(30)) > 0 THEN substr(
        s.remainder,
        instr(s.remainder, char(30)) + 1
      )
      ELSE ''
    END
  FROM split s
  WHERE length(s.remainder) > 0
),
changed_files(path) AS (
  SELECT DISTINCT trim(value) AS path
  FROM split
  WHERE length(trim(value)) > 0
),
impact_walk(file_path, depth, visited) AS (
  SELECT cf.path, 0, char(30) || cf.path || char(30)
  FROM changed_files cf
  UNION ALL
  SELECT
    d.from_path,
    iw.depth + 1,
    iw.visited || d.from_path || char(30)
  FROM dependencies d
  JOIN impact_walk iw ON d.to_path = iw.file_path
  CROSS JOIN params p
  WHERE iw.depth < p.max_depth
    AND instr(iw.visited, char(30) || d.from_path || char(30)) = 0
),
test_files(path) AS (
  SELECT DISTINCT f.path
  FROM files f
  CROSS JOIN params p
  WHERE EXISTS (
      SELECT 1
      FROM test_suites ts
      WHERE ts.file_path = f.path
    )
    OR (
      p.test_glob IS NOT NULL
      AND f.path GLOB p.test_glob
    )
    OR (
      p.test_glob IS NULL
      AND (
        f.path GLOB '*.test.ts'
        OR f.path GLOB '*.test.tsx'
        OR f.path GLOB '*.spec.ts'
        OR f.path GLOB '*.spec.tsx'
        OR f.path GLOB '*.test.js'
        OR f.path GLOB '*.spec.js'
        OR f.path GLOB '*.test.jsx'
        OR f.path GLOB '*.spec.jsx'
      )
    )
)
SELECT
  tf.path AS test_path,
  MIN(iw.depth) AS impact_depth
FROM impact_walk iw
JOIN test_files tf ON tf.path = iw.file_path
GROUP BY tf.path
ORDER BY impact_depth ASC, tf.path ASC;
