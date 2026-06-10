SELECT
  s.name,
  s.kind,
  s.file_path,
  s.line_start,
  s.signature,
  s.doc_comment,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM calls c
      WHERE c.callee_name = s.name
    )
    THEN 'has_callers'
    ELSE 'no_callers'
  END AS reason,
  COALESCE(
    (
      SELECT json_group_array(
        json_object(
          'kind',
          'caller',
          'name',
          caller_name,
          'file_path',
          file_path,
          'line_start',
          line_start
        )
      )
      FROM (
        SELECT c.caller_name, c.file_path, c.line_start
        FROM calls c
        WHERE c.callee_name = s.name
        ORDER BY c.file_path, c.line_start
        LIMIT 3
      )
    ),
    '[]'
  ) AS evidence_json
FROM symbols s
WHERE s.doc_comment LIKE '%@deprecated%'
ORDER BY s.file_path ASC, s.line_start ASC
LIMIT 50;
