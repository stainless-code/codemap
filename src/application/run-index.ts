import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  createSchema,
  getMeta,
  META_FTS5_ENABLED_KEY,
  reconcileBoundaryRules,
  setMeta,
} from "../db";
import type { CodemapDatabase } from "../db";
import { getBoundaryRules, getFts5Enabled } from "../runtime";
import { getStateDir } from "../runtime";
import { refreshFileChurn } from "./churn-ingest";
import type { ChurnRefreshMode } from "./churn-ingest";
import { expandHeritageResolveScope } from "./heritage-resolver";
import {
  collectFiles,
  deleteFilesFromIndex,
  fetchTableStats,
  getChangedFiles,
  getCurrentCommit,
  indexFiles,
  runCallResolveAndSynthesis,
  targetedReindex,
} from "./index-engine";
import { acquireIndexLock } from "./index-lock";
import type {
  IndexPerformanceReport,
  IndexResult,
  IndexTableStats,
} from "./types";

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
    type_heritage: 0,
    calls: 0,
    css_vars: 0,
    css_classes: 0,
    css_keyframes: 0,
    scopes: 0,
    references: 0,
    bindings: 0,
    import_specifiers: 0,
    function_params: 0,
    runtime_markers: 0,
    test_suites: 0,
    re_export_chains: 0,
    module_cycles: 0,
    dynamic_imports: 0,
    file_metrics: 0,
    file_churn: 0,
  };
}

function patchPerformanceJsonWithChurn(churnMs: number): void {
  const perfJsonPath = process.env.CODEMAP_PERFORMANCE_JSON;
  if (perfJsonPath === undefined || perfJsonPath === "") return;
  try {
    if (!existsSync(perfJsonPath)) {
      writeFileSync(
        perfJsonPath,
        JSON.stringify({ churn_ms: churnMs } satisfies Pick<
          IndexPerformanceReport,
          "churn_ms"
        >),
      );
      return;
    }
    const perf = JSON.parse(
      readFileSync(perfJsonPath, "utf-8"),
    ) as IndexPerformanceReport;
    writeFileSync(
      perfJsonPath,
      JSON.stringify({ ...perf, churn_ms: churnMs }, null, 2),
    );
  } catch (err) {
    console.error(
      `[churn] failed to patch performance JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
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
  /**
   * Explicit sha for `meta.last_indexed_commit` — skips `git rev-parse HEAD`.
   * Audit-cache reindex uses this: the cache dir has no `.git` so the shell-out
   * would emit `fatal: not a git repository` and stamp an empty string.
   */
  commit?: string;
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
 * Serialises in-process and via `<state-dir>/index.lock` for cross-process safety.
 */
let indexRunChain: Promise<unknown> = Promise.resolve();

export async function runCodemapIndex(
  db: CodemapDatabase,
  options: RunIndexOptions = {},
): Promise<IndexResult> {
  const run = indexRunChain.then(async () => {
    const release = acquireIndexLock(getStateDir());
    try {
      return await runCodemapIndexBody(db, options);
    } finally {
      release();
    }
  });
  indexRunChain = run.then(
    () => {},
    () => {},
  );
  return run as Promise<IndexResult>;
}

async function runCodemapIndexBody(
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
  let result: IndexResult;
  let churnMode: ChurnRefreshMode = "full";
  let churnChangedPaths: string[] | undefined;
  try {
    if (mode === "full") {
      churnMode = "full";
      if (!quiet) console.log("  Full rebuild requested...");
      const collectStart = performance.now();
      const files = collectFiles();
      const collectMs = performance.now() - collectStart;
      const run = await indexFiles(db, files, true, undefined, {
        quiet,
        performance: wantPerformance,
        collectMs,
        commit: options.commit,
      });
      result = {
        mode: "full",
        indexed: run.indexed,
        skipped: run.skipped,
        elapsedMs: run.elapsedMs,
        stats: run.stats,
      };
    } else if (mode === "files") {
      const targetFiles = options.files ?? [];
      if (targetFiles.length === 0) {
        churnMode = "idle";
        result = {
          mode: "files",
          indexed: 0,
          skipped: 0,
          elapsedMs: 0,
          stats: emptyStats(),
          idle: true,
        };
      } else {
        churnMode = "incremental";
        churnChangedPaths = targetFiles;
        const run = await targetedReindex(db, targetFiles, quiet);
        result = {
          mode: "files",
          indexed: run.indexed,
          skipped: run.skipped,
          elapsedMs: run.elapsedMs,
          stats: run.stats,
        };
      }
    } else {
      // getChangedFiles reads `meta`; the up-front createSchema above covers it.
      const diff = getChangedFiles(db);
      if (diff) {
        if (!quiet) {
          console.log(
            `  Incremental: ${diff.changed.length} changed, ${diff.deleted.length} deleted`,
          );
        }
        if (diff.changed.length > 0) {
          churnMode = "incremental";
          churnChangedPaths = diff.changed;
          const indexedPaths = diff.existingPaths;
          for (const f of diff.changed) indexedPaths.add(f);
          const run = await indexFiles(db, diff.changed, false, indexedPaths, {
            quiet,
            sourceCache: diff.sourceCache,
            existingHashes: diff.existingHashes,
            deletedPaths: diff.deleted,
          });
          result = {
            mode: "incremental",
            indexed: run.indexed,
            skipped: run.skipped,
            elapsedMs: run.elapsedMs,
            stats: run.stats,
          };
        } else if (diff.deleted.length > 0) {
          churnMode = "deletions";
          deleteFilesFromIndex(db, diff.deleted, quiet);
          const callScope = expandHeritageResolveScope(db, diff.deleted);
          if (callScope.length > 0) {
            runCallResolveAndSynthesis(db, callScope);
          }
          setMeta(db, "last_indexed_commit", getCurrentCommit());
          if (!quiet) console.log("  Index updated (deletions only)");
          result = {
            mode: "incremental",
            indexed: 0,
            skipped: 0,
            elapsedMs: 0,
            stats: fetchTableStats(db),
            idle: true,
          };
        } else {
          churnMode = "idle";
          if (!quiet) console.log("  Index is up to date");
          result = {
            mode: "incremental",
            indexed: 0,
            skipped: 0,
            elapsedMs: 0,
            stats: fetchTableStats(db),
            idle: true,
          };
        }
      } else {
        churnMode = "full";
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
        result = {
          mode: "full",
          indexed: run.indexed,
          skipped: run.skipped,
          elapsedMs: run.elapsedMs,
          stats: run.stats,
        };
      }
    }
  } finally {
    reconcileBoundaryRules(db, getBoundaryRules());
  }

  const churn = refreshFileChurn(db, {
    quiet,
    mode: churnMode,
    changedPaths: churnChangedPaths,
  });
  patchPerformanceJsonWithChurn(churn.elapsedMs);
  if (wantPerformance && !quiet && churn.elapsedMs > 0) {
    console.error(`[churn] ingest: ${churn.elapsedMs}ms`);
  }
  return { ...result, stats: fetchTableStats(db) };
}
