import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Cross-process index lock filename inside `<state-dir>/`. */
export const INDEX_LOCK_NAME = "index.lock";

/** Default max lock age before auto-steal when the holder PID is still alive. */
export const DEFAULT_LOCK_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export interface IndexLockPayload {
  pid: number;
  started_at: string;
}

export class IndexLockHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexLockHeldError";
  }
}

export function indexLockPath(stateDir: string): string {
  return join(stateDir, INDEX_LOCK_NAME);
}

export function readIndexLock(lockPath: string): IndexLockPayload | null {
  if (!existsSync(lockPath)) return null;
  try {
    const data = JSON.parse(
      readFileSync(lockPath, "utf-8"),
    ) as IndexLockPayload;
    if (typeof data.pid !== "number" || typeof data.started_at !== "string") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isStaleLock(
  payload: IndexLockPayload,
  opts?: { maxAgeMs?: number; now?: number },
): boolean {
  if (!isPidAlive(payload.pid)) return true;
  const started = Date.parse(payload.started_at);
  if (Number.isNaN(started)) return true;
  const maxAge = opts?.maxAgeMs ?? DEFAULT_LOCK_MAX_AGE_MS;
  return (opts?.now ?? Date.now()) - started > maxAge;
}

function releaseIndexLock(lockPath: string, pid: number): void {
  try {
    const current = readIndexLock(lockPath);
    if (current?.pid === pid) unlinkSync(lockPath);
  } catch {
    // best-effort — stale unlink on next acquire
  }
}

/**
 * Acquire `<state-dir>/index.lock`. Throws {@link IndexLockHeldError} when a
 * live, non-stale lock exists. Auto-steals stale locks with a stderr warning.
 */
export function acquireIndexLock(stateDir: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const lockPath = indexLockPath(stateDir);
  const payload: IndexLockPayload = {
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  const body = `${JSON.stringify(payload)}\n`;

  const tryWrite = (): void => {
    writeFileSync(lockPath, body, { encoding: "utf-8", flag: "wx" });
  };

  try {
    tryWrite();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
    const existing = readIndexLock(lockPath);
    if (existing && isStaleLock(existing)) {
      // eslint-disable-next-line no-console -- intentional ops warning on stderr
      console.error(
        `[codemap] removing stale index lock (pid ${existing.pid})`,
      );
      unlinkSync(lockPath);
      tryWrite();
      return () => releaseIndexLock(lockPath, payload.pid);
    }
    const holder = existing?.pid ?? "unknown";
    throw new IndexLockHeldError(
      `Index already running (lock held by pid ${holder}). Wait for it to finish or run \`codemap unlock\` if the process died.`,
    );
  }

  return () => releaseIndexLock(lockPath, payload.pid);
}

/**
 * Remove `index.lock`. Without `--force`, refuses when the holder PID is alive
 * and the lock is not stale.
 */
export function removeIndexLock(
  stateDir: string,
  opts?: { force?: boolean },
): boolean {
  const lockPath = indexLockPath(stateDir);
  if (!existsSync(lockPath)) return false;
  const existing = readIndexLock(lockPath);
  if (
    !opts?.force &&
    existing &&
    !isStaleLock(existing) &&
    isPidAlive(existing.pid)
  ) {
    throw new IndexLockHeldError(
      `Index lock held by live pid ${existing.pid}. Use \`codemap unlock --force\` to remove anyway.`,
    );
  }
  unlinkSync(lockPath);
  return true;
}
