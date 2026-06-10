WITH params(row_limit, min_complexity, by_symbol, path_prefix) AS (
  SELECT ?, ?, ?, ?
),
base AS (
  SELECT
    fc.file_path,
    s.name AS symbol_name,
    s.kind AS symbol_kind,
    s.line_start,
    fc.weighted_commits,
    fc.commit_count,
    fc.churn_trend,
    s.complexity,
    ROUND(fc.weighted_commits * s.complexity, 2) AS hotspot_score
  FROM file_churn fc
  JOIN symbols s ON s.file_path = fc.file_path
  CROSS JOIN params p
  WHERE s.complexity IS NOT NULL
    AND s.complexity >= p.min_complexity
    AND (p.path_prefix = '' OR fc.file_path LIKE p.path_prefix || '%')
),
file_rows AS (
  SELECT
    file_path,
    NULL AS symbol_name,
    NULL AS symbol_kind,
    NULL AS line_start,
    weighted_commits,
    commit_count,
    churn_trend,
    MAX(complexity) AS max_complexity,
    ROUND(AVG(complexity), 1) AS avg_complexity,
    MAX(hotspot_score) AS hotspot_score
  FROM base
  GROUP BY file_path, weighted_commits, commit_count, churn_trend
),
symbol_rows AS (
  SELECT
    file_path,
    symbol_name,
    symbol_kind,
    line_start,
    weighted_commits,
    commit_count,
    churn_trend,
    complexity AS max_complexity,
    complexity AS avg_complexity,
    hotspot_score
  FROM base
),
combined AS (
  SELECT * FROM file_rows WHERE (SELECT by_symbol FROM params) = 0
  UNION ALL
  SELECT * FROM symbol_rows WHERE (SELECT by_symbol FROM params) != 0
),
normalized AS (
  SELECT
    c.*,
    ROUND(
      100.0 * c.hotspot_score / NULLIF(MAX(c.hotspot_score) OVER (), 0),
      1
    ) AS hotspot_score_normalized
  FROM combined c
)
SELECT *
FROM normalized
ORDER BY hotspot_score DESC, file_path, symbol_name
LIMIT (SELECT row_limit FROM params);
