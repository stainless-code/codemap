WITH params(min_count, path_prefix, min_body_lines) AS (
  SELECT ?, ?, ?
),
filtered AS (
  SELECT s.*
  FROM symbols s
  CROSS JOIN params p
  WHERE s.body_hash IS NOT NULL
    AND (p.path_prefix = '' OR s.file_path LIKE p.path_prefix || '%')
    AND COALESCE(s.body_line_count, 0) >= p.min_body_lines
),
grouped AS (
  SELECT body_hash, COUNT(*) AS duplicate_count
  FROM filtered
  GROUP BY body_hash
  HAVING COUNT(*) >= (SELECT min_count FROM params)
)
SELECT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  s.line_end,
  s.body_hash,
  s.body_line_count,
  g.duplicate_count
FROM filtered s
INNER JOIN grouped g ON g.body_hash = s.body_hash
ORDER BY g.duplicate_count DESC, s.file_path, s.name
LIMIT 50;
