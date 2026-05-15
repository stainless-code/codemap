SELECT
  from_file,
  from_name,
  to_file,
  to_name,
  hops,
  truncated
FROM re_export_chains
ORDER BY hops DESC, from_file, from_name;
