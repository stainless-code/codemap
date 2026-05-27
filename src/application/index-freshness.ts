import type { CodemapDatabase } from "../db";
import { getMeta } from "../db";
import { getChangedFiles, getCurrentCommit } from "./index-engine";
import { getWatchSyncState, isWatchActive } from "./watcher";

/**
 * Index-level freshness metadata for agent transports. Complements per-file
 * `validate` / snippet `stale` — answers "is the whole index behind the
 * checkout?" not "did this one file drift?".
 */
export interface IndexFreshness {
  head_commit: string | null;
  last_indexed_commit: string | null;
  commit_drift: boolean;
  watch_active: boolean;
  pending_sync: boolean;
  pending_paths: number;
  reindex_in_flight: boolean;
  disk_ahead_of_index?: boolean;
  unindexed_change_count?: number;
  history_incompatible?: boolean;
  warning: string | null;
}

export interface ComputeIndexFreshnessOpts {
  /** Runs `getChangedFiles` (git subprocess). Default false — use on `context`. */
  include_disk_drift?: boolean;
}

/**
 * Compute cheap + optional disk-drift freshness signals from an open DB.
 * Pure over DB + module-level watcher state + git subprocesses when opted in.
 */
export function computeIndexFreshness(
  db: CodemapDatabase,
  opts: ComputeIndexFreshnessOpts = {},
): IndexFreshness {
  const lastIndexed = getMeta(db, "last_indexed_commit") ?? null;
  const headRaw = readHeadCommit();
  const headCommit = headRaw === "" ? null : headRaw;

  const watchActive = isWatchActive();
  const sync = getWatchSyncState();
  const pendingSync = sync.pending_paths > 0 || sync.reindex_in_flight === true;

  const commitDrift =
    headCommit !== null && lastIndexed !== null && headCommit !== lastIndexed;

  const freshness: IndexFreshness = {
    head_commit: headCommit,
    last_indexed_commit: lastIndexed,
    commit_drift: commitDrift,
    watch_active: watchActive,
    pending_sync: pendingSync,
    pending_paths: sync.pending_paths,
    reindex_in_flight: sync.reindex_in_flight,
    warning: null,
  };

  if (opts.include_disk_drift === true) {
    if (lastIndexed === null) {
      freshness.disk_ahead_of_index = true;
      freshness.unindexed_change_count = undefined;
      freshness.history_incompatible = false;
    } else {
      const drift = readDiskDrift(db);
      if (drift !== undefined) {
        freshness.disk_ahead_of_index = drift.disk_ahead_of_index;
        freshness.unindexed_change_count = drift.unindexed_change_count;
        freshness.history_incompatible = drift.history_incompatible;
      }
    }
  }

  freshness.warning = buildFreshnessWarning(freshness, lastIndexed);
  return freshness;
}

function readHeadCommit(): string {
  try {
    return getCurrentCommit();
  } catch {
    return "";
  }
}

function readDiskDrift(db: CodemapDatabase):
  | {
      disk_ahead_of_index: boolean;
      unindexed_change_count: number;
      history_incompatible: boolean;
    }
  | undefined {
  try {
    const changed = getChangedFiles(db);
    if (changed === null) {
      return {
        disk_ahead_of_index: true,
        unindexed_change_count: 0,
        history_incompatible: true,
      };
    }
    const count = changed.changed.length + changed.deleted.length;
    return {
      disk_ahead_of_index: count > 0,
      unindexed_change_count: count,
      history_incompatible: false,
    };
  } catch {
    return undefined;
  }
}

function buildFreshnessWarning(
  f: IndexFreshness,
  lastIndexed: string | null,
): string | null {
  if (f.pending_sync) {
    const n = f.pending_paths;
    if (n > 0) {
      return `Index sync pending — ${n} file(s) queued; query results may not reflect the latest edits yet.`;
    }
    return "Index reindex in progress; query results may not reflect the latest edits yet.";
  }
  if (f.history_incompatible === true) {
    return "Git history is incompatible with the indexed commit; run `codemap --full` to rebuild.";
  }
  if (lastIndexed === null) {
    return "No indexed commit recorded; run `codemap` to build the index.";
  }
  if (f.commit_drift) {
    return `Index was built at ${f.last_indexed_commit?.slice(0, 7) ?? "?"} but HEAD is ${f.head_commit?.slice(0, 7) ?? "?"}; run \`codemap\` to catch up.`;
  }
  if (f.disk_ahead_of_index === true) {
    const n = f.unindexed_change_count ?? 0;
    if (n > 0) {
      return `Working tree has ${n} unindexed change(s); run \`codemap\` or enable watch before trusting structural queries.`;
    }
    return "Working tree may be ahead of the index; run `codemap` before trusting structural queries.";
  }
  return null;
}
