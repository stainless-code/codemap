SELECT
  cycle_id,
  cycle_size,
  file_path
FROM module_cycles
ORDER BY cycle_size DESC, cycle_id, file_path;
