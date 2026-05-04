-- Refactor risk per file: (fan_in + 1) × (100 - avg_coverage_pct).
-- Output is per-file (one row per high-risk file) — symbols within a file inherit
-- the file's structural risk. Per-symbol ranking would be misleading because
-- dependencies are tracked at the file level (every symbol in a popular file
-- ties at the same score) — file-level aggregation gives actionable rows.
-- See refactor-risk-ranking.md for tuning axes.
WITH fan_in_per_file AS (
  SELECT to_path, COUNT(*) AS fan_in
  FROM dependencies
  GROUP BY to_path
),
file_coverage AS (
  SELECT
    file_path,
    AVG(COALESCE(coverage_pct, 0)) AS avg_coverage_pct,
    COUNT(*) AS measured_symbols
  FROM coverage
  GROUP BY file_path
),
file_export_count AS (
  SELECT file_path, COUNT(*) AS exported_count
  FROM symbols
  WHERE is_exported = 1
  GROUP BY file_path
)
SELECT
  f.path                                      AS file_path,
  COALESCE(ec.exported_count, 0)              AS exported_count,
  COALESCE(fp.fan_in, 0)                      AS fan_in,
  ROUND(COALESCE(fc.avg_coverage_pct, 0), 1)  AS avg_coverage_pct,
  COALESCE(fc.measured_symbols, 0)            AS measured_symbols,
  ROUND(
    (COALESCE(fp.fan_in, 0) + 1)
    * (100 - COALESCE(fc.avg_coverage_pct, 0)),
    1
  ) AS risk_score
FROM files f
LEFT JOIN fan_in_per_file fp ON fp.to_path = f.path
LEFT JOIN file_coverage fc   ON fc.file_path = f.path
LEFT JOIN file_export_count ec ON ec.file_path = f.path
WHERE COALESCE(ec.exported_count, 0) > 0
ORDER BY risk_score DESC, f.path
LIMIT 30
