-- Demonstrates FTS5 ⨯ symbols ⨯ coverage JOIN composability.
-- Finds @deprecated functions in files that contain TODO/FIXME/HACK markers
-- AND have measured coverage <50% — high-priority cleanup candidates that
-- are also untidy enough to warrant attention.
-- Empty when FTS5 is disabled (`source_fts` empty); enable via
-- `codemap.config.ts` `fts5: true` or `--with-fts` and run `--full`.
SELECT DISTINCT
  s.name AS symbol,
  s.kind,
  s.file_path,
  s.line_start,
  s.line_end,
  ROUND(COALESCE(c.coverage_pct, 0), 1) AS coverage_pct
FROM source_fts fts
JOIN symbols s ON s.file_path = fts.file_path
LEFT JOIN coverage c ON c.file_path = s.file_path
                   AND c.name = s.name
                   AND c.line_start = s.line_start
WHERE source_fts MATCH 'TODO OR FIXME OR HACK'
  AND s.doc_comment LIKE '%@deprecated%'
  AND s.kind = 'function'
  AND COALESCE(c.coverage_pct, 0) < 50
ORDER BY s.file_path, s.line_start
LIMIT 50
