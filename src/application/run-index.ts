import {
  createSchema,
  getMeta,
  META_FTS5_ENABLED_KEY,
  reconcileBoundaryRules,
  setMeta,
} from "../db";
import type { CodemapDatabase } from "../db";
import { getBoundaryRules, getFts5Enabled } from "../runtime";
import {
  collectFiles,
  deleteFilesFromIndex,
  fetchTableStats,
  getChangedFiles,
  getCurrentCommit,
  indexFiles,
  targetedReindex,
} from "./index-engine";
import type { IndexResult, IndexTableStats } from "./types";

/**
 * Returns `true` when the persisted `meta.fts5_enabled` differs from the
 * current resolved config and the caller should upgrade an incremental
 * run to a full rebuild (`docs/plans/fts5-mermaid.md` Q3). First-run
 * (`undefined` meta) seeds the value silently.
 */
function detectFts5ToggleChange(db: CodemapDatabase, mode: IndexMode): boolean {
  const wantEnabled = getFts5Enabled();
  const lastValue = getMeta(db, META_FTS5_ENABLED_KEY);
  if (lastValue === undefined) {
    setMeta(db, META_FTS5_ENABLED_KEY, wantEnabled ? "1" : "0");
    return false;
  }
  const lastEnabled = lastValue === "1";
  if (lastEnabled === wantEnabled) return false;
  if (mode === "full") {
    setMeta(db, META_FTS5_ENABLED_KEY, wantEnabled ? "1" : "0");
    return false;
  }
  console.error(
    `[fts5] toggle change detected (${lastEnabled} → ${wantEnabled}); upgrading this run to a full rebuild so source_fts is consistently populated.`,
  );
  return true;
}

function emptyStats(): IndexTableStats {
  return {
    files: 0,
    symbols: 0,
    imports: 0,
    exports: 0,
    components: 0,
    dependencies: 0,
    markers: 0,
    type_members: 0,
    calls: 0,
    css_vars: 0,
    css_classes: 0,
    css_keyframes: 0,
  };
}

/**
 * - `incremental` — git-based diff vs last indexed commit (default).
 * - `full` — re-glob and re-index everything.
 * - `files` — only `options.files` (paths relative to project root).
 */
export type IndexMode = "incremental" | "full" | "files";

export interface RunIndexOptions {
  /**
   * Defaults to `incremental`.
   */
  mode?: IndexMode;
  /**
   * Paths relative to the project root; used only when `mode === "files"`.
   * All paths are forwarded as-is; non-standard extensions are indexed as text.
   */
  files?: string[];
  /**
   * Suppresses progress logs; parse failures may still be printed. Defaults to `false`.
   */
  quiet?: boolean;
  /**
   * Emits a per-phase timing breakdown and the top-10 slowest files (full
   * rebuild only). Off by default — wired by the CLI's `--performance` flag.
   */
  performance?: boolean;
}

/**
 * Core indexing pipeline (CLI and `Codemap#index`).
 *
 * @param db - Open database; caller owns the connection lifecycle.
 * @param options - Index mode, optional targeted paths, and logging.
 * @returns Row counts and timing; see {@link IndexResult}.
 *
 * @remarks
 * Call `initCodemap()` and `configureResolver()` for this project before invoking (same as CLI bootstrap).
 */
export async function runCodemapIndex(
  db: CodemapDatabase,
  options: RunIndexOptions = {},
): Promise<IndexResult> {
  const quiet = options.quiet ?? false;
  let mode: IndexMode = options.mode ?? "incremental";

  const wantPerformance = options.performance === true;

  // createSchema is idempotent; needed up-front so `meta` exists for the
  // toggle read.
  createSchema(db);
  if (detectFts5ToggleChange(db, mode)) {
    mode = "full";
    setMeta(db, META_FTS5_ENABLED_KEY, getFts5Enabled() ? "1" : "0");
  }

  // Boundary rules track the resolved config exactly. The reconciler runs in
  // `finally` because full rebuild calls `dropAll` inside `indexFiles` which
  // wipes `boundary_rules` (config-derived); reconciling AFTER the index
  // pipeline returns survives that drop on every code path.
  try {
    if (mode === "full") {
      if (!quiet) console.log("  Full rebuild requested...");
      const collectStart = performance.now();
      const files = collectFiles();
      const collectMs = performance.now() - collectStart;
      const run = await indexFiles(db, files, true, undefined, {
        quiet,
        performance: wantPerformance,
        collectMs,
      });
      return {
        mode: "full",
        indexed: run.indexed,
        skipped: run.skipped,
        elapsedMs: run.elapsedMs,
        stats: run.stats,
      };
    }

    if (mode === "files") {
      const targetFiles = options.files ?? [];
      if (targetFiles.length === 0) {
        return {
          mode: "files",
          indexed: 0,
          skipped: 0,
          elapsedMs: 0,
          stats: emptyStats(),
          idle: true,
        };
      }
      const run = await targetedReindex(db, targetFiles, quiet);
      return {
        mode: "files",
        indexed: run.indexed,
        skipped: run.skipped,
        elapsedMs: run.elapsedMs,
        stats: run.stats,
      };
    }

    // Incremental path reads `meta` via getChangedFiles — schema must exist first
    // (indexFiles / targetedReindex call createSchema later; fresh DB had none).
    createSchema(db);
    const diff = getChangedFiles(db);
    if (diff) {
      if (!quiet) {
        console.log(
          `  Incremental: ${diff.changed.length} changed, ${diff.deleted.length} deleted`,
        );
      }
      deleteFilesFromIndex(db, diff.deleted, quiet);
      if (diff.changed.length > 0) {
        const indexedPaths = diff.existingPaths;
        for (const f of diff.changed) indexedPaths.add(f);
        const run = await indexFiles(db, diff.changed, false, indexedPaths, {
          quiet,
        });
        return {
          mode: "incremental",
          indexed: run.indexed,
          skipped: run.skipped,
          elapsedMs: run.elapsedMs,
          stats: run.stats,
        };
      }
      if (diff.deleted.length > 0) {
        setMeta(db, "last_indexed_commit", getCurrentCommit());
        if (!quiet) console.log("  Index updated (deletions only)");
        return {
          mode: "incremental",
          indexed: 0,
          skipped: 0,
          elapsedMs: 0,
          stats: fetchTableStats(db),
          idle: true,
        };
      }
      if (!quiet) console.log("  Index is up to date");
      return {
        mode: "incremental",
        indexed: 0,
        skipped: 0,
        elapsedMs: 0,
        stats: fetchTableStats(db),
        idle: true,
      };
    }

    if (!quiet) {
      console.log(
        "  No previous index or incompatible history, doing full rebuild...",
      );
    }
    const fallbackCollectStart = performance.now();
    const files = collectFiles();
    const fallbackCollectMs = performance.now() - fallbackCollectStart;
    const run = await indexFiles(db, files, true, undefined, {
      quiet,
      performance: wantPerformance,
      collectMs: fallbackCollectMs,
    });
    return {
      mode: "full",
      indexed: run.indexed,
      skipped: run.skipped,
      elapsedMs: run.elapsedMs,
      stats: run.stats,
    };
  } finally {
    reconcileBoundaryRules(db, getBoundaryRules());
  }
}
