SELECT
  (SELECT COUNT(*) FROM calls) AS total_calls,
  (SELECT COUNT(*) FROM calls WHERE callee_resolution_kind IS NOT NULL AND callee_resolution_kind != 'unresolved') AS resolved_calls,
  (SELECT COUNT(*) FROM unresolved_calls) AS unresolved_queue,
  (SELECT value FROM meta WHERE key = 'unresolved_calls_residual') AS residual_meta;
