SELECT
  (SELECT COUNT(*) FROM calls) AS total_calls,
  (SELECT COUNT(*) FROM calls WHERE callee_resolution_kind IS NOT NULL AND callee_resolution_kind != 'unresolved') AS resolved_calls,
  (SELECT COUNT(*) FROM calls WHERE is_method_call = 1 AND (callee_resolution_kind IS NULL OR callee_resolution_kind = 'unresolved')) AS method_calls_deferred,
  (SELECT COUNT(*) FROM unresolved_calls) AS unresolved_queue,
  (SELECT value FROM meta WHERE key = 'unresolved_calls_residual') AS residual_meta;
