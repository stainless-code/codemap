import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
 * Sha-keyed source cache for `audit --base <ref>`. Each entry is a plain
 * extracted tree at `<projectRoot>/.codemap/audit-cache/<sha>/` (no `.git`
 * artifact — `git archive | tar -x`, NOT `git worktree add`) with its own
 * `.codemap/index.db`. Cache-hit detection: that DB exists.
 *
 * **Concurrency.** Per-pid temp dir + POSIX `rename` to the final `<sha>/`
 * slot — losers fall through to cache-hit; no lock files.
 *
 * **Eviction.** LRU after 5 entries OR 500 MiB (D2); plain `rm -rf`.
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
  /** Absolute path to the cached `.codemap/index.db` inside that worktree. */
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

/** Path of the cached DB inside a single cache entry. Mirrors the
 * post-consolidation layout (`<root>/.codemap/index.db`) recursively. */
const CACHE_ENTRY_DB_REL = ".codemap/index.db";

/**
 * Cache-hit fast path. Returns the entry when `<sha>/.codemap/index.db`
 * exists. Caller falls back to {@link populateWorktree} on a miss.
 */
export function lookupCacheEntry(
  sha: string,
  opts: WorktreeCacheOpts,
): PopulatedCacheEntry | undefined {
  const worktreePath = join(opts.projectRoot, CACHE_DIR_NAME, sha);
  const dbPath = join(worktreePath, CACHE_ENTRY_DB_REL);
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
  /** Reindex callback — builds `.codemap/index.db` inside `worktreePath`.
   *  `commit` is the resolved sha (so the caller can stamp it without a `git rev-parse HEAD` shell-out in the `.git`-less cache dir). */
  reindex: (worktreePath: string, commit: string) => Promise<void>;
}

/**
 * Populate a cache entry atomically (D11): per-pid temp dir → `git archive |
 * tar -x` → caller's `reindex` builds the DB → POSIX `rename` to the final
 * `<sha>/` slot. Lost-race losers fall through to `lookupCacheEntry`. Temp
 * dirs are removed in `finally` so `.codemap/audit-cache/.tmp.*` never
 * accumulates.
 */
export async function populateWorktree(
  opts: PopulateOpts,
): Promise<PopulatedCacheEntry | WorktreeError> {
  const cacheRoot = join(opts.projectRoot, CACHE_DIR_NAME);
  mkdirSync(cacheRoot, { recursive: true });

  // randomUUID() suffix on top of (sha, pid, ms) — defensive against
  // cross-process races where two `codemap audit --base` invocations share
  // the same sha and start within the same millisecond. Mutex (audit-engine)
  // already serialises in-process; this catches the multi-process case.
  const tmpName = `.tmp.${opts.sha}.${process.pid}.${Date.now()}.${randomUUID()}`;
  const tmpPath = join(cacheRoot, tmpName);
  const finalPath = join(cacheRoot, opts.sha);

  let cleanup = true;
  try {
    mkdirSync(tmpPath, { recursive: true });
    // `spawnSync`'s default `maxBuffer` (1 MiB) silently truncates real-sized
    // monorepo tarballs; 1 GiB is the working cap.
    const archive = spawnSync("git", ["archive", "--format=tar", opts.sha], {
      cwd: opts.projectRoot,
      env: gitSpawnEnv(),
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (archive.status !== 0) {
      const stderr = archive.stderr.toString().trim();
      // `worktree-add-failed` code retained for API stability — external
      // consumers discriminate on `code`, not the underlying primitive.
      return {
        code: "worktree-add-failed",
        error: `codemap audit: git archive failed for sha ${opts.sha}${
          stderr ? ` (${stderr})` : ""
        }.`,
      };
    }
    const extract = spawnSync("tar", ["-xf", "-", "-C", tmpPath], {
      input: archive.stdout,
    });
    if (extract.status !== 0) {
      const stderr = extract.stderr.toString().trim();
      return {
        code: "worktree-add-failed",
        error: `codemap audit: tar extract failed for sha ${opts.sha}${
          stderr ? ` (${stderr})` : ""
        }.`,
      };
    }

    try {
      await opts.reindex(tmpPath, opts.sha);
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
      removeWorktree(tmpPath);
    }
  }

  // Pass `protectPath` so the freshly-populated entry can't be its own victim
  // (single huge entry > MAX_CACHE_BYTES would otherwise oscillate between
  // re-populate and return-dead-path).
  evictIfOverLimits(opts.projectRoot, finalPath);

  return {
    worktreePath: finalPath,
    dbPath: join(finalPath, CACHE_ENTRY_DB_REL),
    sha: opts.sha,
    indexedAt: Date.now(),
  };
}

/**
 * `rm -rf <path>` — used by rollback (failed populate) and eviction. Errors
 * are swallowed; the next eviction cycle sweeps stragglers.
 */
function removeWorktree(worktreePath: string): void {
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
 * minutes are also swept (orphans from crashed populates). `protectPath`
 * is excluded from both counts and eviction — callers pass the freshly-
 * populated entry so it can't evict itself when a single entry exceeds
 * `MAX_CACHE_BYTES`.
 */
function evictIfOverLimits(projectRoot: string, protectPath?: string): void {
  const cacheRoot = join(projectRoot, CACHE_DIR_NAME);
  if (!existsSync(cacheRoot)) return;

  const now = Date.now();
  const entries: CacheEntryInfo[] = [];
  for (const name of readdirSync(cacheRoot)) {
    const path = join(cacheRoot, name);
    if (path === protectPath) continue;
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
        removeWorktree(path);
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
    removeWorktree(victim.path);
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
    removeWorktree(join(cacheRoot, name));
  }
}
