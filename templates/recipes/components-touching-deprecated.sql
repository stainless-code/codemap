-- Components touching @deprecated symbols (UNION of hook + call paths).
-- Hook path: components.hooks_used JSON contains a @deprecated symbol name.
-- Call path: calls.caller_name = components.name AND callee is @deprecated.
WITH touched AS (
  SELECT
    c.name        AS component,
    c.file_path   AS component_file,
    s.name        AS deprecated_symbol,
    s.file_path   AS deprecated_file,
    'hook'        AS via
  FROM components c
  JOIN symbols s ON s.doc_comment LIKE '%@deprecated%'
  WHERE c.hooks_used LIKE '%"' || s.name || '"%'
  UNION
  SELECT
    c.name,
    c.file_path,
    s.name,
    s.file_path,
    'call'
  FROM components c
  JOIN calls ca ON ca.caller_name = c.name AND ca.file_path = c.file_path
  JOIN symbols s ON s.name = ca.callee_name AND s.doc_comment LIKE '%@deprecated%'
)
SELECT * FROM touched
ORDER BY component_file, component, deprecated_symbol
LIMIT 50
