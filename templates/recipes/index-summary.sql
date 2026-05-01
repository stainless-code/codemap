SELECT
  (SELECT COUNT(*) FROM files) AS files,
  (SELECT COUNT(*) FROM symbols) AS symbols,
  (SELECT COUNT(*) FROM imports) AS imports,
  (SELECT COUNT(*) FROM components) AS components,
  (SELECT COUNT(*) FROM dependencies) AS dependencies
