-- Exports never directly imported (V1: resolved-path matching only).
-- An export is "directly used" if any imports row's resolved_path matches its
-- file AND the specifiers JSON contains its name (or "*" for namespace imports).
--
-- V1 limitations (documented in unimported-exports.md):
-- 1. Re-export chains: rows with a matching `re_export_chains` hop get
--    `reason=reexport_chain_possible`.
-- 2. Unresolved imports: `resolved_path IS NULL` with a matching specifier get
--    `reason=unresolved_import_blind_spot` (hint only — may be external package).
-- 3. Default exports skipped (often framework entry points).
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
    WHEN EXISTS (
      SELECT 1
      FROM imports i
      CROSS JOIN json_each(i.specifiers) j
      WHERE i.resolved_path IS NULL
        AND j.value = u.name
    )
    THEN 'unresolved_import_blind_spot'
    ELSE 'no_direct_import'
  END AS reason,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM re_export_chains r
      WHERE r.to_file = u.file_path
        AND r.to_name = u.name
    )
    THEN COALESCE(
      (
        SELECT
          CASE
            WHEN chain_total > 3
            THEN json_insert(chain_hops, '$[#]', json_object('truncated', json('true')))
            ELSE chain_hops
          END
        FROM (
          SELECT
            (
              SELECT COUNT(*)
              FROM re_export_chains r
              WHERE r.to_file = u.file_path
                AND r.to_name = u.name
            ) AS chain_total,
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
                    hops,
                    'truncated',
                    truncated
                  )
                )
                FROM (
                  SELECT r.from_file, r.to_file, r.hops, r.truncated
                  FROM re_export_chains r
                  WHERE r.to_file = u.file_path
                    AND r.to_name = u.name
                  ORDER BY r.from_file, r.hops
                  LIMIT 3
                )
              ),
              '[]'
            ) AS chain_hops
        )
      ),
      '[]'
    )
    WHEN EXISTS (
      SELECT 1
      FROM imports i
      CROSS JOIN json_each(i.specifiers) j
      WHERE i.resolved_path IS NULL
        AND j.value = u.name
    )
    THEN COALESCE(
      (
        SELECT
          CASE
            WHEN hop_total > 3
            THEN json_insert(unresolved_hops, '$[#]', json_object('truncated', json('true')))
            ELSE unresolved_hops
          END
        FROM (
          SELECT
            (
              SELECT COUNT(*)
              FROM imports i
              CROSS JOIN json_each(i.specifiers) j
              WHERE i.resolved_path IS NULL
                AND j.value = u.name
            ) AS hop_total,
            COALESCE(
              (
                SELECT json_group_array(
                  json_object(
                    'kind',
                    'unresolved_import',
                    'file_path',
                    file_path,
                    'source',
                    source,
                    'specifier',
                    specifier
                  )
                )
                FROM (
                  SELECT i.file_path, i.source, j.value AS specifier
                  FROM imports i
                  CROSS JOIN json_each(i.specifiers) j
                  WHERE i.resolved_path IS NULL
                    AND j.value = u.name
                  ORDER BY i.file_path, i.source
                  LIMIT 3
                )
              ),
              '[]'
            ) AS unresolved_hops
        )
      ),
      '[]'
    )
    ELSE '[]'
  END AS evidence_json
FROM unimported u
ORDER BY u.file_path, u.name
LIMIT 50
