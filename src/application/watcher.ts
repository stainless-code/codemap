import { extname, relative, sep } from "node:path";

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";

import { closeDb, openDb } from "../db";
import { runCodemapIndex } from "./run-index";

/**
 * `codemap watch` engine — keeps `.codemap.db` fresh on file edits so
 * every CLI / MCP / HTTP query reads live data without a per-request
 * reindex prelude. See [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage).
 *
 * **Layering:** chokidar is the only file-watcher backend (pure JS;
 * works identically on Bun + Node, no per-runtime branching). All other
 * pieces (debouncer, path filter, lifecycle) are pure transport-
 * agnostic helpers that the CLI shell + `serve --watch` / `mcp --watch`
 * embeds wrap.
 */

/** Same TS / TSX / JS / JSX / CSS extensions the indexer cares about. */
const INDEXED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
]);

/**
 * True if `relPath` (project-root-relative, POSIX-separated) is something
 * the indexer cares about: matches an indexed extension AND no path
 * segment is in the exclude set (`node_modules`, `.git`, `dist`, etc.).
 *
 * Pure — same predicate the watcher applies to every chokidar event
 * before queueing a reindex. Recipe paths
 * (`<root>/.codemap/recipes/<id>.{sql,md}`) are also returned (caller
 * uses `runCodemapIndex` which handles them out-of-band).
 */
export function shouldIndexPath(
  relPath: string,
  excludeDirNames: ReadonlySet<string>,
): boolean {
  if (relPath === "" || relPath === ".") return false;
  // Path-segment scan: bail if any segment is excluded. Hand-rolled (no
  // .split('/')) so we don't allocate per call — watcher fires on every
  // unrelated edit, this hot-loops.
  let start = 0;
  for (let i = 0; i <= relPath.length; i++) {
    const ch = i < relPath.length ? relPath.charCodeAt(i) : 0;
    if (ch === 47 /* / */ || ch === 92 /* \\ */ || i === relPath.length) {
      if (i > start && excludeDirNames.has(relPath.slice(start, i))) {
        return false;
      }
      start = i + 1;
    }
  }
  // Check extension last (cheaper bail above).
  const ext = extname(relPath);
  if (INDEXED_EXTENSIONS.has(ext)) return true;
  // Project-local recipes: <root>/.codemap/recipes/<id>.{sql,md}.
  // The path-segment scan above doesn't exclude `.codemap` since it's
  // not in excludeDirNames (the whole .codemap.db dir lives under it).
  // `relPath` is always POSIX (toRelativePosix normalizes Windows
  // backslashes); compare with a literal `/` prefix so Windows recipe
  // changes match too. (Earlier sep-built prefix mismatched on Windows
  // — caught by CodeRabbit on PR #47.)
  if (
    (ext === ".sql" || ext === ".md") &&
    relPath.startsWith(".codemap/recipes/")
  ) {
    return true;
  }
  return false;
}

/**
 * Coalesce add / change / unlink events into a single batch fired after
 * `delayMs` of quiet. Resets the timer on every `trigger()` so a burst
 * of edits (e.g. `git checkout`, `npm install`) collapses to one
 * reindex call instead of one per file.
 *
 * Pure — caller wires the actual flush handler. Test-driven: a fake
 * timer can drive `flushNow` deterministically.
 */
export interface Debouncer {
  /** Add a path to the pending set; resets the quiet timer. */
  trigger(path: string): void;
  /** Force-flush the pending set immediately (called on shutdown). */
  flushNow(): void;
  /** Clear the timer + pending set without flushing (test cleanup). */
  reset(): void;
  /** Current pending set size (for tests / status logs). */
  pendingSize(): number;
}

export function createDebouncer(
  onFlush: (paths: ReadonlySet<string>) => void,
  delayMs: number,
): Debouncer {
  let pending: Set<string> = new Set();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.size === 0) return;
    const batch = pending;
    pending = new Set();
    onFlush(batch);
  };

  return {
    trigger(path) {
      pending.add(path);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flushNow: flush,
    reset() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = new Set();
    },
    pendingSize() {
      return pending.size;
    },
  };
}

/** Default debounce — long enough to coalesce a single editor save burst, short enough that agents don't perceive lag. */
export const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Module-level "watcher is keeping the index live" flag. Read by
 * `handleAudit` to skip its incremental-index prelude — turning the
 * audit's expensive boot-time prelude into a no-op in `mcp --watch`
 * / `serve --watch` deployments. See [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage).
 *
 * **Set true ONLY after** the optional `onPrime` callback resolves
 * (typically a `runCodemapIndex({mode: 'incremental'})` catch-up). A
 * watcher that just booted hasn't seen the historical drift between
 * `last_indexed_commit` and HEAD — handleAudit must NOT trust the
 * index until that catch-up runs. Caught by CodeRabbit on PR #47.
 *
 * **Set false when:** stop() is called (graceful shutdown), or the
 * backend emits an error (chokidar dying mid-flight). The "active"
 * status reflects "the watcher is healthy AND has caught up", not raw
 * "we tried to start a watcher".
 *
 * Single-flag design: the watcher is process-scoped — at most one live
 * watcher per server process, so a singleton matches the actual
 * topology.
 */
let watchActive = false;

export function isWatchActive(): boolean {
  return watchActive;
}

/** Test-only escape hatch — drops the flag so a test that booted a fake watcher leaves a clean slate for siblings. */
export function _resetWatchStateForTests(): void {
  watchActive = false;
}

/** Test-only escape hatch — flips the flag without booting a real watcher (for handleAudit prelude-skip tests). */
export function _markWatchActiveForTests(): void {
  watchActive = true;
}

/**
 * Standard `onPrime` callback for embedders that want `handleAudit` to
 * skip its incremental-index prelude. Runs an incremental reindex
 * against the current HEAD before the watcher is marked active, so
 * the "watcher is keeping the index live" claim is true on first
 * tool call (not just for events that arrive after boot). See the
 * `watchActive` JSDoc above + CodeRabbit on PR #47.
 */
export function createPrimeIndex(opts: {
  quiet: boolean;
  label?: string;
}): () => Promise<void> {
  const prefix = opts.label ?? "codemap watch";
  return async () => {
    const t0 = performance.now();
    const db = openDb();
    try {
      await runCodemapIndex(db, { mode: "incremental", quiet: true });
    } finally {
      closeDb(db);
    }
    if (!opts.quiet) {
      const ms = Math.round(performance.now() - t0);
      // eslint-disable-next-line no-console -- intentional prime-status log
      console.error(`${prefix}: prime catch-up indexed in ${ms}ms`);
    }
  };
}

/**
 * Standard onChange callback every embedder uses (cmd-watch, serve
 * --watch, mcp --watch): open DB, run targeted reindex on the changed
 * paths, log a one-line status to stderr unless `quiet`. Errors are
 * caught + logged so a transient parse failure doesn't kill the watch
 * loop.
 */
export function createReindexOnChange(opts: {
  quiet: boolean;
  /** Optional label so serve/mcp embedders distinguish their stderr lines from a standalone watch session. */
  label?: string;
}): (paths: ReadonlySet<string>) => Promise<void> {
  const prefix = opts.label ?? "codemap watch";
  return async (paths) => {
    const t0 = performance.now();
    try {
      const db = openDb();
      try {
        await runCodemapIndex(db, {
          mode: "files",
          files: [...paths],
          quiet: true,
        });
      } finally {
        closeDb(db);
      }
      if (!opts.quiet) {
        const ms = Math.round(performance.now() - t0);
        // eslint-disable-next-line no-console -- intentional batch-status log on stderr
        console.error(`${prefix}: reindex ${paths.size} file(s) in ${ms}ms`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- intentional error log on stderr
      console.error(`${prefix}: reindex failed — ${msg}`);
    }
  };
}

export interface WatchLoopOpts {
  /** Project root the indexer is configured for. */
  root: string;
  /** `getExcludeDirNames()` — passed in so the engine doesn't reach into runtime state. */
  excludeDirNames: ReadonlySet<string>;
  /** Coalesced reindex callback. Path set is project-relative POSIX. */
  onChange: (paths: ReadonlySet<string>) => void | Promise<void>;
  /**
   * Optional priming callback — runs after `backend.start()` but BEFORE
   * `isWatchActive()` flips to `true`. Embedders that want
   * `handleAudit` to skip its incremental-index prelude MUST supply
   * this (typically `() => runCodemapIndex({mode: 'incremental'})`),
   * otherwise the watcher is "running but not yet caught up" — see the
   * `watchActive` JSDoc above. If undefined, the flag flips immediately
   * (suitable for tests that don't care about audit prelude behavior).
   */
  onPrime?: () => Promise<void>;
  /** Override the default debounce; use 0 for testing. */
  debounceMs?: number;
  /**
   * Optional injected backend so tests don't need a real chokidar.
   * Production leaves this undefined and we boot a real `FSWatcher`.
   */
  backend?: WatchBackend;
}

/**
 * Backend abstraction so tests can drive the engine without spinning up
 * real filesystem watches (which are flaky in CI containers and would
 * pull chokidar into every test boot).
 */
export interface WatchBackend {
  /** Start watching `root`; emit `path` (absolute) on `add` / `change` / `unlink`. */
  start(opts: {
    root: string;
    onEvent: (kind: "add" | "change" | "unlink", absPath: string) => void;
    onError: (err: Error) => void;
  }): void;
  /** Async to mirror chokidar's `.close()`. */
  stop(): Promise<void>;
}

/**
 * Boot the watcher. Returns a handle the caller uses to stop the loop
 * (drains the debounce timer + closes the underlying watcher).
 *
 * `onChange` is invoked with project-relative POSIX paths; the absolute
 * → relative + slash-normalize translation happens here so handlers
 * never see backslashes on Windows.
 */
export function runWatchLoop(opts: WatchLoopOpts): {
  stop: () => Promise<void>;
} {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  // Track in-flight onChange so stop() can drain. Serialise rather than
  // overlap — concurrent reindexes against the same DB are pointless and
  // can clash on writes. CodeRabbit caught the original fire-and-forget
  // on PR #47 (a stop() that returned while an onChange was still
  // re-indexing left the DB in a half-state).
  let inFlight: Promise<void> = Promise.resolve();
  const debouncer = createDebouncer((paths) => {
    inFlight = inFlight
      .then(() => Promise.resolve(opts.onChange(paths)))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console -- intentional onChange-error log
        console.error(`codemap watch: onChange failed — ${msg}`);
      });
  }, debounceMs);

  const backend: WatchBackend = opts.backend ?? createChokidarBackend();

  backend.start({
    root: opts.root,
    onEvent: (_kind, absPath) => {
      const rel = toRelativePosix(opts.root, absPath);
      if (!shouldIndexPath(rel, opts.excludeDirNames)) return;
      debouncer.trigger(rel);
    },
    onError: (err) => {
      // Backend dying mid-flight = we're no longer keeping the index
      // live. Clear the flag so handleAudit re-enables its prelude
      // until the embedder restarts the watcher (or process exits).
      // CodeRabbit caught this on PR #47.
      watchActive = false;
      // eslint-disable-next-line no-console -- intentional: watcher errors must surface
      console.error(`codemap watch: backend error — ${err.message}`);
    },
  });

  // Priming: only flip the active flag AFTER the optional catch-up
  // resolves. Without this, a `mcp --watch audit` immediately after
  // boot would skip the incremental-index prelude and read whatever
  // was in `.codemap.db` from the prior run (potentially stale by N
  // commits). CodeRabbit raised the freshness race on PR #47.
  let primingDone: Promise<void>;
  if (opts.onPrime === undefined) {
    watchActive = true;
    primingDone = Promise.resolve();
  } else {
    primingDone = (async () => {
      try {
        await opts.onPrime!();
        watchActive = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console -- intentional: prime errors must surface
        console.error(
          `codemap watch: prime failed — ${msg} (handleAudit will continue running its prelude)`,
        );
        // Leave watchActive = false; embedder may decide to stop or
        // tolerate. We don't tear down here — the watcher is still
        // catching new edits, just can't promise historical freshness.
      }
    })();
  }

  return {
    async stop() {
      // Stop early so handleAudit doesn't keep skipping prelude while
      // we're shutting down (any in-flight audit reads a "stale"
      // signal which is the correct conservative behavior).
      watchActive = false;
      // Wait for the priming pass to finish (if still running) so we
      // don't tear down its DB connection out from under it.
      await primingDone;
      // Force any pending debounced batch to fire one last time.
      debouncer.flushNow();
      // Drain in-flight onChange (the just-fired batch + any prior
      // ones still re-indexing).
      await inFlight;
      await backend.stop();
    },
  };
}

/**
 * Convert an absolute path emitted by chokidar to a project-relative
 * POSIX path matching `files.path` storage format. Mirrors
 * `toProjectRelative` in `validate-engine.ts` (Windows backslashes →
 * forward slashes) but works on absolute inputs.
 */
function toRelativePosix(root: string, absPath: string): string {
  const rel = relative(root, absPath);
  return sep === "/" ? rel : rel.split(sep).join("/");
}

/**
 * Production backend: chokidar v5 with `awaitWriteFinish` (chunked-
 * write detection — handles editors that write large files in chunks)
 * and `atomic` (mv-replace editors don't trigger spurious unlink+add).
 */
function createChokidarBackend(): WatchBackend {
  let watcher: FSWatcher | undefined;
  return {
    start({ root, onEvent, onError }) {
      watcher = chokidar.watch(root, {
        ignoreInitial: true,
        atomic: true,
        // See chokidar docs § Persistence — `awaitWriteFinish: true`
        // polls file size until stable, defaulting to 2s. We use a
        // shorter window since codemap reindex is cheap on a single
        // file and we'd rather react quickly.
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        // Glob ignore — the watcher fires on every fs event under root,
        // even paths the indexer doesn't care about. Filter at the
        // backend layer so the JS-side filter (`shouldIndexPath`) only
        // sees plausible candidates.
        ignored: (path, stats) => {
          if (stats === undefined) return false; // dir not yet stat'd
          if (!stats.isFile()) return false;
          // Cheapest filter: skip anything inside a dot-dir other than
          // .codemap/recipes (which we want to watch for project recipes).
          // chokidar passes absolute paths; convert to root-relative.
          const rel = toRelativePosix(root, path);
          return !rel.startsWith(".codemap/recipes/")
            ? rel.includes("/node_modules/") ||
                rel.includes("/.git/") ||
                rel.startsWith("node_modules/") ||
                rel.startsWith(".git/") ||
                rel.startsWith(".codemap/")
            : false;
        },
      });
      watcher.on("add", (p) => onEvent("add", p));
      watcher.on("change", (p) => onEvent("change", p));
      watcher.on("unlink", (p) => onEvent("unlink", p));
      watcher.on("error", (err) => onError(err as Error));
    },
    async stop() {
      if (watcher !== undefined) {
        await watcher.close();
        watcher = undefined;
      }
    },
  };
}
