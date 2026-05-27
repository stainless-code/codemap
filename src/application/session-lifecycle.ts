import type { WatchBackend } from "./watcher";
import { runWatchLoop } from "./watcher";

/** Session lifecycle for long-running `mcp` / `serve` — see docs/architecture.md § Session lifecycle wiring. */

/** Watcher stop grace between HTTP requests — not MCP idle shutdown. */
export const HTTP_WATCH_RELEASE_GRACE_MS = 5000;

export const STDIO_PARENT_POLL_MS = 2000;

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ESRCH"
    ) {
      return false;
    }
    // EPERM — process exists but we cannot signal it.
    return true;
  }
}

export interface StdioDisconnectMonitor {
  dispose(): void;
}

/** SDK stdio `transport.onclose` fires only after explicit `transport.close()`. */
export function createStdioDisconnectMonitor(
  onDisconnect: (reason: string) => void,
  opts?: {
    parentPid?: number;
    pollIntervalMs?: number;
  },
): StdioDisconnectMonitor {
  let disposed = false;
  const parentPid = opts?.parentPid ?? process.ppid;

  const finish = (reason: string): void => {
    if (disposed) return;
    disposed = true;
    clearInterval(pollTimer);
    process.stdin.off("end", onStdinClosed);
    process.stdin.off("close", onStdinClosed);
    process.stdout.off("error", onStdoutError);
    onDisconnect(reason);
  };

  const onStdinClosed = (): void => {
    finish("client stdin closed");
  };

  const onStdoutError = (err: NodeJS.ErrnoException): void => {
    if (err.code === "EPIPE") {
      finish("client stdout broken pipe");
    }
  };

  process.stdin.on("end", onStdinClosed);
  process.stdin.on("close", onStdinClosed);
  process.stdout.on("error", onStdoutError);

  const pollTimer = setInterval(() => {
    if (!isProcessAlive(parentPid)) {
      finish("parent process exited");
    }
  }, opts?.pollIntervalMs ?? STDIO_PARENT_POLL_MS);
  pollTimer.unref?.();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(pollTimer);
      process.stdin.off("end", onStdinClosed);
      process.stdin.off("close", onStdinClosed);
      process.stdout.off("error", onStdoutError);
    },
  };
}

export interface ManagedWatchSessionOpts {
  root: string;
  excludeDirNames: ReadonlySet<string>;
  recipesWatchPrefix: string;
  debounceMs: number;
  onPrime?: () => Promise<void>;
  onChange: (paths: ReadonlySet<string>) => void | Promise<void>;
  /** MCP passes 0; HTTP uses `HTTP_WATCH_RELEASE_GRACE_MS`. */
  releaseGraceMs?: number;
  backend?: WatchBackend;
}

export interface ManagedWatchSession {
  acquireClient(): Promise<void>;
  releaseClient(): Promise<void>;
  forceStop(): Promise<void>;
  clientCount(): number;
  isWatching(): boolean;
}

export function createManagedWatchSession(
  opts: ManagedWatchSessionOpts,
): ManagedWatchSession {
  let clients = 0;
  let handle: { stop: () => Promise<void>; ready: Promise<void> } | undefined;
  let starting: Promise<void> | undefined;
  let stopInFlight: Promise<void> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const releaseGraceMs = opts.releaseGraceMs ?? 0;

  const cancelScheduledStop = (): void => {
    if (stopTimer !== undefined) {
      clearTimeout(stopTimer);
      stopTimer = undefined;
    }
  };

  const ensureStarted = async (): Promise<void> => {
    if (handle !== undefined) {
      await handle.ready;
      return;
    }
    if (starting !== undefined) {
      await starting;
      return;
    }
    starting = (async () => {
      const loop = runWatchLoop({
        root: opts.root,
        excludeDirNames: opts.excludeDirNames,
        recipesWatchPrefix: opts.recipesWatchPrefix,
        debounceMs: opts.debounceMs,
        onPrime: opts.onPrime,
        onChange: opts.onChange,
        backend: opts.backend,
      });
      await loop.ready;
      handle = loop;
    })();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  };

  const stopWatcher = async (): Promise<void> => {
    cancelScheduledStop();
    if (starting !== undefined) {
      await starting;
    }
    if (handle === undefined) return;
    const current = handle;
    handle = undefined;
    const stopping = current.stop().finally(() => {
      if (stopInFlight === stopping) stopInFlight = undefined;
    });
    stopInFlight = stopping;
    await stopping;
  };

  return {
    async acquireClient() {
      cancelScheduledStop();
      if (stopInFlight !== undefined) {
        await stopInFlight;
      }
      clients++;
      try {
        await ensureStarted();
      } catch (err) {
        clients--;
        throw err;
      }
    },
    async releaseClient() {
      if (clients <= 0) return;
      clients--;
      if (clients > 0) return;
      if (releaseGraceMs <= 0) {
        await stopWatcher();
        return;
      }
      cancelScheduledStop();
      stopTimer = setTimeout(() => {
        stopTimer = undefined;
        if (clients === 0) {
          void stopWatcher().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console -- grace stop failure should be visible
            console.error(`codemap watch: grace stop failed — ${msg}`);
          });
        }
      }, releaseGraceMs);
      stopTimer.unref?.();
    },
    async forceStop() {
      clients = 0;
      await stopWatcher();
    },
    clientCount() {
      return clients;
    },
    isWatching() {
      return handle !== undefined;
    },
  };
}

export function bindWatchClientRelease(
  res: { once(event: "finish" | "close", listener: () => void): void },
  session: ManagedWatchSession,
): void {
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    void session.releaseClient().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- release failure should be visible
      console.error(`codemap watch: client release failed — ${msg}`);
    });
  };
  res.once("finish", release);
  res.once("close", release);
}
