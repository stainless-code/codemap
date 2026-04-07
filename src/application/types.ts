/**
 * Row counts per table after an index run (mirrors CLI summary output).
 */
export interface IndexTableStats extends Record<string, number> {
  files: number;
  symbols: number;
  imports: number;
  exports: number;
  components: number;
  dependencies: number;
  markers: number;
  css_vars: number;
  css_classes: number;
  css_keyframes: number;
}

/**
 * Per-run counters; see {@link IndexResult} for the public shape returned from indexing APIs.
 */
export interface IndexRunStats {
  indexed: number;
  skipped: number;
  elapsedMs: number;
  fullRebuild: boolean;
  stats: IndexTableStats;
}

/**
 * Outcome of `Codemap#index` or `runCodemapIndex` (CLI and programmatic index runs).
 */
export interface IndexResult {
  /**
   * How the index was updated.
   */
  mode: "full" | "incremental" | "files";
  /**
   * Files written or re-indexed in this run.
   */
  indexed: number;
  /**
   * Files skipped (unchanged hash).
   */
  skipped: number;
  elapsedMs: number;
  stats: IndexTableStats;
  /**
   * Set when no file bodies were indexed (already fresh, empty `files` list, or deletions-only pass).
   */
  idle?: boolean;
}
