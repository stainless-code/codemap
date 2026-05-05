SELECT
  d.from_path AS file_path,
  d.to_path,
  b.name AS rule_name,
  b.from_glob AS rule_from_glob,
  b.to_glob AS rule_to_glob
FROM dependencies d
JOIN boundary_rules b
  ON b.action = 'deny'
 AND d.from_path GLOB b.from_glob
 AND d.to_path GLOB b.to_glob
ORDER BY b.name, d.from_path, d.to_path;
