/**
 * Row counts per table after an index run (mirrors CLI summary output). Keys
 * use the **SQLite table names** (snake_case: `type_members`, `css_vars`,
 * `css_classes`, `css_keyframes`) so the same identifiers work directly in
 * `SELECT … FROM <key>` queries.
 */
export interface IndexTableStats extends Record<string, number> {
  files: number;
  symbols: number;
  imports: number;
  exports: number;
  components: number;
  dependencies: number;
  markers: number;
  type_members: number;
  calls: number;
  css_vars: number;
  css_classes: number;
  css_keyframes: number;
}

/**
 * Optional per-phase timing breakdown emitted when `--performance` is set.
 * Top-10 slowest files are surfaced for quick triage of pathological inputs
 * (giant generated files, regex-heavy fixtures, etc.).
 */
export interface IndexPerformanceReport {
  /** Time to glob the project root and collect candidate paths. */
  collect_ms: number;
  /** Worker-side parse time (sum across workers, full rebuild only). */
  parse_ms: number;
  /** Bulk SQL INSERT time on the main thread. */
  insert_ms: number;
  /** Deferred B-tree build via `CREATE INDEX` (full rebuild only). */
  index_create_ms: number;
  /**
   * `indexFiles` wall-clock — `parse + insert + index_create + DDL`. Does
   * **not** include `collect_ms` (collect happens before `indexFiles`); the
   * end-to-end run wall is `collect_ms + total_ms`.
   */
  total_ms: number;
  /** Up to 10 files with the highest per-file parse time, descending. */
  slowest_files: { path: string; parse_ms: number }[];
}

/**
 * Per-run counters; see {@link IndexResult} for the public shape returned from indexing APIs.
 */
export interface IndexRunStats {
  /** Number of files written or re-indexed in this run. */
  indexed: number;
  /** Files whose `content_hash` matched the index (no work done). */
  skipped: number;
  /** Wall-clock time for the indexing pipeline, in milliseconds. */
  elapsedMs: number;
  /** `true` if this run dropped and rebuilt all tables; `false` for incremental / targeted. */
  fullRebuild: boolean;
  /** Row counts per table after the run completed. */
  stats: IndexTableStats;
  /** Set only when `--performance` (or `RunIndexOptions.performance`) is on. */
  performance?: IndexPerformanceReport;
}

/**
 * Outcome of `Codemap#index` or `runCodemapIndex` (CLI and programmatic index runs).
 */
export interface IndexResult {
  /** How the index was updated. */
  mode: "full" | "incremental" | "files";
  /** Files written or re-indexed in this run. */
  indexed: number;
  /** Files skipped (unchanged hash). */
  skipped: number;
  /** Wall-clock time for the indexing pipeline, in milliseconds. */
  elapsedMs: number;
  /** Row counts per table after the run completed. */
  stats: IndexTableStats;
  /** Set when no file bodies were indexed (already fresh, empty `files` list, or deletions-only pass). */
  idle?: boolean;
}
