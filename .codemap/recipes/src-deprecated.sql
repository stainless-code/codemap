-- @deprecated symbols defined under `src/` only.
-- Scopes the bundled `deprecated-symbols` recipe to production code, excluding
-- fixtures / tests / docs that may legitimately reference deprecated APIs.
SELECT name, kind, file_path, line_start, doc_comment
FROM symbols
WHERE doc_comment LIKE '%@deprecated%'
  AND file_path LIKE 'src/%'
ORDER BY file_path, name;
