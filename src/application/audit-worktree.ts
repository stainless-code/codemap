import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Strip GIT_* env vars before spawning a fixture git command. Inherited
 * `GIT_INDEX_FILE` / `GIT_DIR` (set by an outer git operation, e.g. when
 * codemap runs from inside a husky pre-commit hook) would otherwise route
 * spawned git calls at the WRONG repo's index. The audit worktree path
 * always resolves itself via `cwd`; honoring inherited git env would
 * actively break it.
 */
function gitSpawnEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    e[k] = v;
  }
  return e;
}

/**
 * Sha-keyed worktree cache for `audit --base <ref>`.
 *
 * Each cache entry is a populated `git worktree` at `<projectRoot>/.codemap/audit-cache/<sha>/`
 * containing the materialised tree at that commit AND a temp `.codemap.db`
 * indexed against it. Cache-hit detection is "does `<sha>/.codemap.db` exist?"
 * — atomic populate (D11) guarantees the DB only appears after a successful
 * reindex, so a cache hit never observes a half-written entry.
 *
 * **Concurrency.** Two parallel `audit --base <ref>` invocations resolving to
 * the same sha race-safely: each writes to a per-pid temp dir, then POSIX
 * `rename` claims the final `<sha>/` slot. Whichever rename loses gets EEXIST
 * on most platforms — we treat that as "the winner already populated, fall
 * through to cache-hit." No lock files needed.
 *
 * **Eviction.** LRU after 5 entries OR 500 MiB (D2). Computed by directory
 * mtime; `git worktree remove --force` then `rm -rf` to clean up.
 */

const CACHE_DIR_NAME = ".codemap/audit-cache";
const MAX_CACHE_ENTRIES = 5;
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

export interface WorktreeCacheOpts {
  projectRoot: string;
}

export interface PopulatedCacheEntry {
  /** Absolute path to the cached worktree dir. */
  worktreePath: string;
  /** Absolute path to the `.codemap.db` inside that worktree. */
  dbPath: string;
  /** Resolved sha this entry was created against. */
  sha: string;
  /** Cache-mtime in epoch-ms — surfaces as `AuditBase.indexed_at`. */
  indexedAt: number;
}

export type WorktreeError =
  | { error: string; code: "not-git-repo" }
  | { error: string; code: "ref-unresolved" }
  | { error: string; code: "worktree-add-failed" }
  | { error: string; code: "reindex-failed" };

/**
 * Resolve `<ref>` to a sha via `git rev-parse --verify "<ref>^{commit}"`.
 * Returns `{error, code}` on failure (no git, ref not found, etc.).
 */
export function resolveSha(
  ref: string,
  projectRoot: string,
): { sha: string } | WorktreeError {
  if (!isGitRepo(projectRoot)) {
    return {
      code: "not-git-repo",
      error: "codemap audit: --base requires a git repository.",
    };
  }
  const out = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: projectRoot,
    env: gitSpawnEnv(),
  });
  if (out.status !== 0) {
    const stderr = out.stderr.toString().trim();
    return {
      code: "ref-unresolved",
      error: `codemap audit: --base: cannot resolve "${ref}" to a commit${
        stderr ? ` (${stderr})` : ""
      }.`,
    };
  }
  return { sha: out.stdout.toString().trim() };
}

export function isGitRepo(projectRoot: string): boolean {
  return existsSync(join(projectRoot, ".git"));
}

/**
 * Cache-hit fast path. Returns the entry when `<sha>/.codemap.db` exists.
 * Caller falls back to {@link populateWorktree} on a miss.
 */
export function lookupCacheEntry(
  sha: string,
  opts: WorktreeCacheOpts,
): PopulatedCacheEntry | undefined {
  const worktreePath = join(opts.projectRoot, CACHE_DIR_NAME, sha);
  const dbPath = join(worktreePath, ".codemap.db");
  if (!existsSync(dbPath)) return undefined;
  return {
    worktreePath,
    dbPath,
    sha,
    indexedAt: statSync(dbPath).mtimeMs,
  };
}

export interface PopulateOpts extends WorktreeCacheOpts {
  sha: string;
  /** Reindex callback — receives the worktree path, must build `.codemap.db` inside it. */
  reindex: (worktreePath: string) => Promise<void>;
}

/**
 * Populate a cache entry atomically (D11):
 * 1. mkdir per-pid temp dir under the cache root
 * 2. `git worktree add <tmp> <sha>`
 * 3. caller's `reindex(<tmp>)` builds `.codemap.db`
 * 4. `rename(<tmp>, <sha>)` — POSIX-atomic; if the final slot already exists
 *    (raced with a concurrent populate), discard the temp and use the winner.
 *
 * On failure mid-populate, the temp dir + worktree are removed in a `finally`
 * so `.codemap/audit-cache/.tmp.*` never accumulates.
 */
export async function populateWorktree(
  opts: PopulateOpts,
): Promise<PopulatedCacheEntry | WorktreeError> {
  const cacheRoot = join(opts.projectRoot, CACHE_DIR_NAME);
  mkdirSync(cacheRoot, { recursive: true });

  const tmpName = `.tmp.${opts.sha}.${process.pid}.${Date.now()}`;
  const tmpPath = join(cacheRoot, tmpName);
  const finalPath = join(cacheRoot, opts.sha);

  let cleanup = true;
  try {
    const add = spawnSync(
      "git",
      ["worktree", "add", "--detach", tmpPath, opts.sha],
      { cwd: opts.projectRoot, env: gitSpawnEnv() },
    );
    if (add.status !== 0) {
      const stderr = add.stderr.toString().trim();
      return {
        code: "worktree-add-failed",
        error: `codemap audit: git worktree add failed for sha ${opts.sha}${
          stderr ? ` (${stderr})` : ""
        }.`,
      };
    }

    try {
      await opts.reindex(tmpPath);
    } catch (err) {
      return {
        code: "reindex-failed",
        error: `codemap audit: reindex failed on worktree (${
          err instanceof Error ? err.message : String(err)
        }).`,
      };
    }

    try {
      renameSync(tmpPath, finalPath);
      cleanup = false;
    } catch {
      // Lost the race — the final slot already exists. Trust the winner's
      // entry and fall through to cache-hit. The temp dir is removed in
      // the `finally` below.
      const winner = lookupCacheEntry(opts.sha, opts);
      if (winner !== undefined) return winner;
      // Unexpected: rename failed AND no winner present. Surface a clean
      // error rather than poisoning subsequent runs.
      return {
        code: "worktree-add-failed",
        error: `codemap audit: cache rename failed for sha ${opts.sha} and no existing entry found.`,
      };
    }
  } finally {
    if (cleanup && existsSync(tmpPath)) {
      removeWorktree(tmpPath, opts.projectRoot);
    }
  }

  evictIfOverLimits(opts.projectRoot);

  return {
    worktreePath: finalPath,
    dbPath: join(finalPath, ".codemap.db"),
    sha: opts.sha,
    indexedAt: Date.now(),
  };
}

/**
 * `git worktree remove --force <path>` followed by `rm -rf` for safety.
 * Used by both rollback (failed populate) and eviction. Errors are
 * swallowed — best-effort cleanup; the next eviction cycle sweeps stragglers.
 */
function removeWorktree(worktreePath: string, projectRoot: string): void {
  spawnSync("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: projectRoot,
    env: gitSpawnEnv(),
  });
  if (existsSync(worktreePath)) {
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Best-effort — leave for the next sweep.
    }
  }
}

interface CacheEntryInfo {
  sha: string;
  path: string;
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * LRU sweep — runs after every successful populate. Removes oldest entries
 * until under both ENTRY and BYTE budgets. `.tmp.*` dirs older than a few
 * minutes are also swept (orphans from crashed populates).
 */
function evictIfOverLimits(projectRoot: string): void {
  const cacheRoot = join(projectRoot, CACHE_DIR_NAME);
  if (!existsSync(cacheRoot)) return;

  const now = Date.now();
  const entries: CacheEntryInfo[] = [];
  for (const name of readdirSync(cacheRoot)) {
    const path = join(cacheRoot, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (name.startsWith(".tmp.")) {
      // Sweep orphan temp dirs older than 10 min — must be from crashed runs
      // because successful populates rename the dir away within seconds.
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        removeWorktree(path, projectRoot);
      }
      continue;
    }
    entries.push({
      sha: name,
      path,
      mtimeMs: stat.mtimeMs,
      sizeBytes: dirSizeBytes(path),
    });
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  let totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  let count = entries.length;
  // Pop oldest until under both limits.
  while (
    (count > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) &&
    entries.length > 0
  ) {
    const victim = entries.pop();
    if (!victim) break;
    removeWorktree(victim.path, projectRoot);
    totalBytes -= victim.sizeBytes;
    count -= 1;
  }
}

function dirSizeBytes(path: string): number {
  let total = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += statSync(full).size;
        } catch {
          // skipped
        }
      }
    }
  }
  return total;
}

/**
 * Test-only — wipe the cache root. Tests use this between scenarios to
 * avoid cross-test pollution. Production callers go through the LRU.
 */
export function _wipeCacheForTests(projectRoot: string): void {
  const cacheRoot = join(projectRoot, CACHE_DIR_NAME);
  if (!existsSync(cacheRoot)) return;
  for (const name of readdirSync(cacheRoot)) {
    removeWorktree(join(cacheRoot, name), projectRoot);
  }
}
