import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  getMeta,
  mergeFileChurnForPaths,
  META_CHURN_CONFIG_FINGERPRINT,
  META_CHURN_INDEXED_COMMIT,
  pruneFileChurnOrphans,
  replaceFileChurn,
  setMeta,
} from "../db";
import type { FileChurnRow } from "../db";
import {
  getChurnFilePath,
  getChurnHalfLifeDays,
  getChurnSince,
  getProjectRoot,
} from "../runtime";
import type { CodemapDatabase } from "../sqlite-db";
import { ingestChurnFromConfigPath } from "./ingest-churn-run";

export const DEFAULT_CHURN_HALF_LIFE_DAYS = 90;
const MIN_COMMITS_FOR_TREND = 4;
const TREND_ACCELERATING_RATIO = 0.6;
const TREND_COOLING_RATIO = 0.4;

/** Strip inherited GIT_* so subprocess targets the resolved repo root. */
function gitSpawnEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    e[k] = v;
  }
  return e;
}

function gitTopLevel(projectRoot: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: projectRoot,
    env: gitSpawnEnv(),
  });
  if (r.status !== 0) return null;
  return r.stdout.toString().trim();
}

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Map a git path (repo-relative) to an indexed `files.path` under `projectRoot`. */
function indexedPathFromGit(
  gitPath: string,
  projectPrefix: string,
): string | null {
  const p = toPosix(gitPath);
  if (projectPrefix === "") return p;
  const prefix = `${projectPrefix}/`;
  if (!p.startsWith(prefix)) return null;
  return p.slice(prefix.length);
}

function indexedToGitPath(filePath: string, projectPrefix: string): string {
  if (projectPrefix === "" || projectPrefix === ".") return filePath;
  return `${projectPrefix}/${filePath}`;
}

export type ChurnTrend = "accelerating" | "stable" | "cooling";

export type ChurnRefreshMode = "full" | "incremental" | "idle" | "deletions";

export interface ChurnIngestResult {
  ok: boolean;
  rowCount: number;
  elapsedMs: number;
  /** User/agent-readable skip reason (non-git, git error, idle cache hit). */
  reason?: string;
}

interface ChurnAcc {
  commit_count: number;
  weighted_commits: number;
  recent_weighted: number;
  older_weighted: number;
  lines_added: number;
  lines_removed: number;
  last_commit_at: string | null;
  last_commit_ts: number;
}

/**
 * Classify churn trend from recency-split weighted commit mass.
 * Recent window = commits within `halfLifeDays / 2`; older = the rest.
 */
export function computeChurnTrend(
  acc: Pick<ChurnAcc, "commit_count" | "recent_weighted" | "older_weighted">,
): ChurnTrend | null {
  if (acc.commit_count < MIN_COMMITS_FOR_TREND) return null;
  const total = acc.recent_weighted + acc.older_weighted;
  if (total <= 0) return null;
  const ratio = acc.recent_weighted / total;
  if (ratio >= TREND_ACCELERATING_RATIO) return "accelerating";
  if (ratio <= TREND_COOLING_RATIO) return "cooling";
  return "stable";
}

function accsToRows(
  byFile: Map<string, ChurnAcc>,
  computedAt: string,
): FileChurnRow[] {
  return [...byFile.entries()].map(([file_path, a]) => ({
    file_path,
    commit_count: a.commit_count,
    weighted_commits: Math.round(a.weighted_commits * 1000) / 1000,
    lines_added: a.lines_added,
    lines_removed: a.lines_removed,
    last_commit_at: a.last_commit_at,
    churn_trend: computeChurnTrend(a),
    computed_at: computedAt,
  }));
}

function parseGitNumstatLog(
  stdout: string,
  options: {
    indexedPaths: Set<string>;
    projectPrefix: string;
    halfLife: number;
    scopeFilter?: Set<string>;
  },
): Map<string, ChurnAcc> {
  const nowSec = Math.floor(Date.now() / 1000);
  const recentWindowDays = options.halfLife / 2;
  const byFile = new Map<string, ChurnAcc>();
  let commitTs = 0;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("COMMIT ")) {
      const parts = line.split(" ");
      commitTs = Number(parts[2] ?? 0);
      continue;
    }
    if (!line.trim() || commitTs <= 0) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const rest = line.slice(tab + 1);
    const tab2 = rest.indexOf("\t");
    if (tab2 < 0) continue;
    const addedRaw = line.slice(0, tab);
    const removedRaw = rest.slice(0, tab2);
    const gitPath = rest.slice(tab2 + 1);
    if (addedRaw === "-" || removedRaw === "-") continue;

    const filePath = indexedPathFromGit(gitPath, options.projectPrefix);
    if (!filePath || !options.indexedPaths.has(filePath)) continue;
    if (options.scopeFilter && !options.scopeFilter.has(filePath)) continue;

    const added = Number(addedRaw) || 0;
    const removed = Number(removedRaw) || 0;
    const ageDays = Math.max(0, (nowSec - commitTs) / 86_400);
    const weight = 0.5 ** (ageDays / options.halfLife);

    let acc = byFile.get(filePath);
    if (!acc) {
      acc = {
        commit_count: 0,
        weighted_commits: 0,
        recent_weighted: 0,
        older_weighted: 0,
        lines_added: 0,
        lines_removed: 0,
        last_commit_at: null,
        last_commit_ts: 0,
      };
      byFile.set(filePath, acc);
    }
    acc.commit_count += 1;
    acc.weighted_commits += weight;
    if (ageDays <= recentWindowDays) {
      acc.recent_weighted += weight;
    } else {
      acc.older_weighted += weight;
    }
    acc.lines_added += added;
    acc.lines_removed += removed;
    if (commitTs >= acc.last_commit_ts) {
      acc.last_commit_ts = commitTs;
      acc.last_commit_at = new Date(commitTs * 1000).toISOString();
    }
  }
  return byFile;
}

function countFileChurn(db: CodemapDatabase): number {
  return (
    db.query<{ n: number }>("SELECT COUNT(*) AS n FROM file_churn").get()?.n ??
    0
  );
}

function resolveGitHead(projectRoot: string): string | null {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    env: gitSpawnEnv(),
  });
  if (r.status !== 0) return null;
  const head = r.stdout.toString().trim();
  return head.length > 0 ? head : null;
}

function churnConfigFingerprint(
  halfLifeDays: number,
  since: string | null,
): string {
  return `${halfLifeDays}|${since ?? ""}`;
}

function stampChurnMeta(
  db: CodemapDatabase,
  projectRoot: string,
  halfLifeDays: number,
  since: string | null,
): void {
  const head = resolveGitHead(projectRoot);
  if (head) setMeta(db, META_CHURN_INDEXED_COMMIT, head);
  setMeta(
    db,
    META_CHURN_CONFIG_FINGERPRINT,
    churnConfigFingerprint(halfLifeDays, since),
  );
}

function canIdleSkipChurn(
  db: CodemapDatabase,
  head: string | null,
  prevHead: string | null,
  halfLifeDays: number,
  since: string | null,
): boolean {
  if (!head || !prevHead || head !== prevHead) return false;
  if (countFileChurn(db) === 0) return false;
  const fp = churnConfigFingerprint(halfLifeDays, since);
  return getMeta(db, META_CHURN_CONFIG_FINGERPRINT) === fp;
}

function tryConfigChurnFallback(
  db: CodemapDatabase,
  projectRoot: string,
  quiet: boolean,
  finish: (partial: Omit<ChurnIngestResult, "elapsedMs">) => ChurnIngestResult,
): ChurnIngestResult | null {
  let churnFile: string | null = null;
  try {
    churnFile = getChurnFilePath();
  } catch {
    return null;
  }
  if (!churnFile) return null;
  const loaded = ingestChurnFromConfigPath(db, {
    projectRoot,
    churnFile,
  });
  if (!loaded || !loaded.ok) return null;
  if (!quiet) {
    console.error(
      `[churn] file_churn loaded from config churn.file: ${loaded.ingested} files`,
    );
  }
  return finish({ ok: true, rowCount: loaded.ingested });
}

/**
 * Populate `file_churn` from `git log --numstat` scoped to indexed paths.
 */
export function ingestFileChurnFromGit(
  db: CodemapDatabase,
  options: {
    projectRoot: string;
    halfLifeDays?: number;
    since?: string | null;
    quiet?: boolean;
    /** When set, only these indexed paths are recomputed (merge, not full replace). */
    scopePaths?: string[];
  },
): ChurnIngestResult {
  const t0 = performance.now();
  const projectRoot = resolveRealPath(resolve(options.projectRoot));
  const halfLife = options.halfLifeDays ?? DEFAULT_CHURN_HALF_LIFE_DAYS;
  const since = options.since?.trim() || null;
  const quiet = options.quiet ?? false;
  const scopePaths = options.scopePaths;
  const merge = scopePaths !== undefined && scopePaths.length > 0;

  const finish = (
    partial: Omit<ChurnIngestResult, "elapsedMs">,
  ): ChurnIngestResult => ({
    ...partial,
    elapsedMs: Math.round(performance.now() - t0),
  });

  if (!existsSync(resolve(projectRoot, ".git"))) {
    const top = gitTopLevel(projectRoot);
    if (!top) {
      if (!merge) replaceFileChurn(db, []);
      const reason = "skipped: not a git repository (file_churn empty)";
      if (!quiet) console.error(`[churn] ${reason}`);
      const fallback = tryConfigChurnFallback(db, projectRoot, quiet, finish);
      return fallback ?? finish({ ok: false, rowCount: 0, reason });
    }
  }

  const gitRootRaw = gitTopLevel(projectRoot);
  if (!gitRootRaw) {
    if (!merge) replaceFileChurn(db, []);
    const reason = "skipped: git unavailable (file_churn empty)";
    if (!quiet) console.error(`[churn] ${reason}`);
    const fallback = tryConfigChurnFallback(db, projectRoot, quiet, finish);
    return fallback ?? finish({ ok: false, rowCount: 0, reason });
  }

  const indexedPaths = new Set(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );
  if (indexedPaths.size === 0) {
    replaceFileChurn(db, []);
    return finish({ ok: true, rowCount: 0 });
  }

  const gitRoot = resolveRealPath(gitRootRaw);
  const projectPrefix = toPosix(relative(gitRoot, projectRoot));

  let pathspecArgs: string[];
  let scopeFilter: Set<string> | undefined;
  if (merge && scopePaths) {
    scopeFilter = new Set(scopePaths);
    pathspecArgs = scopePaths.map((p) => indexedToGitPath(p, projectPrefix));
  } else {
    pathspecArgs = [
      projectPrefix === "" || projectPrefix === "." ? "." : projectPrefix,
    ];
  }

  const logArgs = [
    "log",
    "--numstat",
    "--format=COMMIT %H %ct",
    ...(since ? [`${since}..HEAD`] : []),
    "--",
    ...pathspecArgs,
  ];
  const log = spawnSync("git", logArgs, {
    cwd: gitRootRaw,
    env: gitSpawnEnv(),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (log.status !== 0) {
    if (!merge) replaceFileChurn(db, []);
    const reason = `skipped: git log failed (${log.stderr?.toString().trim() || "unknown"})`;
    if (!quiet) console.error(`[churn] ${reason}`);
    const fallback = tryConfigChurnFallback(db, projectRoot, quiet, finish);
    return fallback ?? finish({ ok: false, rowCount: 0, reason });
  }

  const computedAt = new Date().toISOString();
  const byFile = parseGitNumstatLog(log.stdout, {
    indexedPaths,
    projectPrefix,
    halfLife,
    scopeFilter,
  });
  const rows = accsToRows(byFile, computedAt);

  if (merge && scopePaths) {
    mergeFileChurnForPaths(db, rows, scopePaths);
    pruneFileChurnOrphans(db);
  } else {
    replaceFileChurn(db, rows);
  }

  const rowCount = countFileChurn(db);
  if (!quiet && rows.length > 0) {
    console.error(
      `[churn] file_churn ${merge ? "merged" : "populated"}: ${rows.length} files (${rowCount} total)`,
    );
  }
  stampChurnMeta(db, projectRoot, halfLife, since);
  return finish({ ok: true, rowCount });
}

/** Index-time churn refresh — git-native with config JSON fallback. */
export function refreshFileChurn(
  db: CodemapDatabase,
  options?: {
    quiet?: boolean;
    projectRoot?: string;
    halfLifeDays?: number;
    since?: string | null;
    mode?: ChurnRefreshMode;
    changedPaths?: string[];
  },
): ChurnIngestResult {
  const t0 = performance.now();
  const quiet = options?.quiet ?? false;
  const mode = options?.mode ?? "full";
  const projectRoot = options?.projectRoot ?? getProjectRoot();
  const halfLifeDays = options?.halfLifeDays ?? getChurnHalfLifeDays();
  const since = options?.since !== undefined ? options.since : getChurnSince();

  let configChurnFile: string | null = null;
  try {
    configChurnFile = getChurnFilePath();
  } catch {
    configChurnFile = null;
  }
  if (configChurnFile) {
    const loaded = ingestChurnFromConfigPath(db, {
      projectRoot,
      churnFile: configChurnFile,
    });
    const rowCount = countFileChurn(db);
    if (!loaded?.ok) {
      const reason = loaded?.error ?? "config churn.file ingest failed";
      if (!quiet) console.error(`[churn] ${reason}`);
      return {
        ok: false,
        rowCount,
        elapsedMs: Math.round(performance.now() - t0),
        reason,
      };
    }
    if (!quiet) {
      console.error(
        `[churn] file_churn loaded from config churn.file: ${loaded.ingested} files`,
      );
    }
    return {
      ok: true,
      rowCount: loaded.ingested,
      elapsedMs: Math.round(performance.now() - t0),
      reason: "config churn.file",
    };
  }

  const head = resolveGitHead(projectRoot);
  const prevHead = getMeta(db, META_CHURN_INDEXED_COMMIT) ?? null;

  if (
    mode === "idle" &&
    canIdleSkipChurn(db, head, prevHead, halfLifeDays, since ?? null)
  ) {
    const rowCount = countFileChurn(db);
    return {
      ok: true,
      rowCount,
      elapsedMs: Math.round(performance.now() - t0),
      reason: "skipped: HEAD unchanged",
    };
  }

  if (mode === "deletions") {
    const rowCount = countFileChurn(db);
    stampChurnMeta(db, projectRoot, halfLifeDays, since ?? null);
    return {
      ok: true,
      rowCount,
      elapsedMs: Math.round(performance.now() - t0),
      reason: "deletions: churn pruned via CASCADE",
    };
  }

  const base = {
    projectRoot,
    halfLifeDays,
    since: since ?? null,
    quiet,
  };

  if (
    mode === "incremental" &&
    options?.changedPaths &&
    options.changedPaths.length > 0
  ) {
    return ingestFileChurnFromGit(db, {
      ...base,
      scopePaths: options.changedPaths,
    });
  }

  return ingestFileChurnFromGit(db, base);
}
