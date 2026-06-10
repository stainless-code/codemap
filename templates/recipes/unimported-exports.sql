-- Exports never directly imported (V1: resolved-path matching only).
-- An export is "directly used" if any imports row's resolved_path matches its
-- file AND the specifiers JSON contains its name (or "*" for namespace imports).
--
-- V1 limitations (documented in unimported-exports.md):
-- 1. Re-export chains: if A re-exports `bar` from B, and consumers import `bar`
--    from A, the recipe doesn't follow the chain — false positive on B.bar.
--    Rows with a matching `re_export_chains` hop get `reason=reexport_chain_possible`.
-- 2. Unresolved imports (`resolved_path IS NULL`, e.g. tsconfig path aliases
--    that codemap's resolver can't resolve) get IGNORED — false positives if
--    they actually reference an export.
-- 3. Default exports skipped (often framework entry points like Next.js
--    page.tsx, Storybook stories, vite.config.ts).
WITH direct_uses AS (
  SELECT DISTINCT e.id
  FROM exports e
  JOIN imports i ON i.resolved_path = e.file_path
  CROSS JOIN json_each(i.specifiers) j
  WHERE j.value = e.name OR j.value = '*'
),
unimported AS (
  -- File-scope suppressions only — `exports` has no line_number column.
  SELECT
    e.name,
    e.kind,
    e.file_path,
    e.is_default,
    e.re_export_source
  FROM exports e
  LEFT JOIN suppressions s
    ON s.file_path = e.file_path
   AND s.recipe_id = 'unimported-exports'
   AND s.line_number = 0
  WHERE e.id NOT IN (SELECT id FROM direct_uses)
    AND e.is_default = 0
    AND e.kind != 're-export'
    AND s.id IS NULL
)
SELECT
  u.name,
  u.kind,
  u.file_path,
  u.is_default,
  u.re_export_source,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM re_export_chains r
      WHERE r.to_file = u.file_path
        AND r.to_name = u.name
    )
    THEN 'reexport_chain_possible'
    ELSE 'no_direct_import'
  END AS reason,
  COALESCE(
    (
      SELECT json_group_array(
        json_object(
          'kind',
          'reexport',
          'from_file',
          from_file,
          'to_file',
          to_file,
          'hops',
          hops
        )
      )
      FROM (
        SELECT r.from_file, r.to_file, r.hops
        FROM re_export_chains r
        WHERE r.to_file = u.file_path
          AND r.to_name = u.name
        ORDER BY r.from_file, r.hops
        LIMIT 3
      )
    ),
    '[]'
  ) AS evidence_json
FROM unimported u
ORDER BY u.file_path, u.name
LIMIT 50
