-- Advisory: members of exported types with no detectable importer.
-- Field-level cousin of `unimported-exports`. Caveats (indexed access,
-- keyof, mapped types, destructuring, re-export chains) live in the .md.
WITH imported_type_names AS (
  SELECT DISTINCT spec.value AS name
  FROM imports i
  CROSS JOIN json_each(i.specifiers) spec
  WHERE spec.value != '*'
),
unimported_exported_types AS (
  SELECT DISTINCT e.name, e.file_path
  FROM exports e
  WHERE e.is_default = 0
    AND e.kind != 're-export'
    AND e.name NOT IN (SELECT name FROM imported_type_names)
)
SELECT
  tm.symbol_name AS owner_type,
  tm.name AS member,
  tm.type AS member_type,
  tm.is_optional,
  tm.is_readonly,
  tm.file_path
FROM type_members tm
JOIN unimported_exported_types u
  ON u.name = tm.symbol_name AND u.file_path = tm.file_path
ORDER BY tm.file_path, tm.symbol_name, tm.name
LIMIT 50;
