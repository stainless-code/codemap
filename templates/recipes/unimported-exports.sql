-- Exports never directly imported (V1: resolved-path matching only).
-- An export is "directly used" if any imports row's resolved_path matches its
-- file AND the specifiers JSON contains its name (or "*" for namespace imports).
--
-- V1 limitations (documented in unimported-exports.md):
-- 1. Re-export chains: if A re-exports `bar` from B, and consumers import `bar`
--    from A, the recipe doesn't follow the chain — false positive on B.bar.
--    Workaround: skip rows with `kind = 're-export'` or hand-check via
--    `re_export_source` column.
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
)
SELECT
  e.name,
  e.kind,
  e.file_path,
  e.is_default,
  e.re_export_source
FROM exports e
WHERE e.id NOT IN (SELECT id FROM direct_uses)
  AND e.is_default = 0
  AND e.kind != 're-export'
ORDER BY e.file_path, e.name
LIMIT 50
