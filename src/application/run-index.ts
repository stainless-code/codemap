import { extname } from "node:path";

import { getAllFileHashes, setMeta } from "../db";
import type { CodemapDatabase } from "../db";
import {
  collectFiles,
  deleteFilesFromIndex,
  getChangedFiles,
  getCurrentCommit,
  indexFiles,
  targetedReindex,
  VALID_EXTENSIONS,
} from "./index-engine";
import type { IndexResult, IndexTableStats } from "./types";

function emptyStats(): IndexTableStats {
  return {
    files: 0,
    symbols: 0,
    imports: 0,
    exports: 0,
    components: 0,
    dependencies: 0,
    markers: 0,
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
  /** Defaults to `incremental`. */
  mode?: IndexMode;
  /**
   * Paths relative to the project root; used only when `mode === "files"`.
   * Non-indexable extensions are filtered out.
   */
  files?: string[];
  /** Suppresses progress logs; parse failures may still be printed. Defaults to `false`. */
  quiet?: boolean;
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
  const mode: IndexMode = options.mode ?? "incremental";

  if (mode === "full") {
    if (!quiet) console.log("  Full rebuild requested...");
    const files = collectFiles();
    const run = await indexFiles(db, files, true, undefined, { quiet });
    return {
      mode: "full",
      indexed: run.indexed,
      skipped: run.skipped,
      elapsedMs: run.elapsedMs,
      stats: run.stats,
    };
  }

  if (mode === "files") {
    const targetFiles = (options.files ?? []).filter((f) => {
      const ext = extname(f);
      return VALID_EXTENSIONS.has(ext);
    });
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

  const diff = getChangedFiles(db);
  if (diff) {
    if (!quiet) {
      console.log(
        `  Incremental: ${diff.changed.length} changed, ${diff.deleted.length} deleted`,
      );
    }
    deleteFilesFromIndex(db, diff.deleted, quiet);
    if (diff.changed.length > 0) {
      const indexedPaths = new Set(getAllFileHashes(db).keys());
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
        stats: fetchStats(db),
        idle: true,
      };
    }
    if (!quiet) console.log("  Index is up to date");
    return {
      mode: "incremental",
      indexed: 0,
      skipped: 0,
      elapsedMs: 0,
      stats: fetchStats(db),
      idle: true,
    };
  }

  if (!quiet) {
    console.log(
      "  No previous index or incompatible history, doing full rebuild...",
    );
  }
  const files = collectFiles();
  const run = await indexFiles(db, files, true, undefined, { quiet });
  return {
    mode: "full",
    indexed: run.indexed,
    skipped: run.skipped,
    elapsedMs: run.elapsedMs,
    stats: run.stats,
  };
}

function fetchStats(db: CodemapDatabase): IndexTableStats {
  const row = db
    .query<Record<string, number>>(
      `SELECT
        (SELECT COUNT(*) FROM files) as files,
        (SELECT COUNT(*) FROM symbols) as symbols,
        (SELECT COUNT(*) FROM imports) as imports,
        (SELECT COUNT(*) FROM exports) as exports,
        (SELECT COUNT(*) FROM components) as components,
        (SELECT COUNT(*) FROM dependencies) as dependencies,
        (SELECT COUNT(*) FROM markers) as markers,
        (SELECT COUNT(*) FROM css_variables) as css_vars,
        (SELECT COUNT(*) FROM css_classes) as css_classes,
        (SELECT COUNT(*) FROM css_keyframes) as css_keyframes`,
    )
    .get()!;
  return row as IndexTableStats;
}
