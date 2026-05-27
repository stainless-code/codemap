import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { EventEmitter } from "node:events";

import {
  bindWatchClientRelease,
  createManagedWatchSession,
  createStdioDisconnectMonitor,
  isProcessAlive,
} from "./session-lifecycle";
import type { WatchBackend } from "./watcher";
import { _resetWatchStateForTests } from "./watcher";

function fakeBackend(): WatchBackend {
  return {
    start() {},
    async stop() {},
  };
}

afterEach(() => {
  _resetWatchStateForTests();
});

describe("isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent pid", () => {
    expect(isProcessAlive(2_147_483_647)).toBe(false);
  });
});

describe("createStdioDisconnectMonitor", () => {
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: originalStdin,
    });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      value: originalStdout,
    });
  });

  it("fires on stdin end", () => {
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      value: stdout,
    });

    const reasons: string[] = [];
    const monitor = createStdioDisconnectMonitor(
      (reason) => reasons.push(reason),
      {
        parentPid: process.pid,
        pollIntervalMs: 60_000,
      },
    );
    stdin.emit("end");
    expect(reasons).toEqual(["client stdin closed"]);
    monitor.dispose();
  });

  it("fires on stdout EPIPE", () => {
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      value: stdout,
    });

    const reasons: string[] = [];
    const monitor = createStdioDisconnectMonitor(
      (reason) => reasons.push(reason),
      {
        parentPid: process.pid,
        pollIntervalMs: 60_000,
      },
    );
    stdout.emit(
      "error",
      Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
    );
    expect(reasons).toEqual(["client stdout broken pipe"]);
    monitor.dispose();
  });

  it("fires when the parent pid is no longer alive", async () => {
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: stdin,
    });
    Object.defineProperty(process, "stdout", {
      configurable: true,
      value: stdout,
    });

    const alive = spyOn(
      await import("./session-lifecycle"),
      "isProcessAlive",
    ).mockReturnValue(false);

    const reasons: string[] = [];
    const monitor = createStdioDisconnectMonitor(
      (reason) => reasons.push(reason),
      {
        parentPid: 42,
        pollIntervalMs: 5,
      },
    );

    await Bun.sleep(20);
    expect(reasons).toEqual(["parent process exited"]);
    monitor.dispose();
    alive.mockRestore();
  });
});

describe("createManagedWatchSession", () => {
  it("starts the watcher on first acquire and stops on last release", async () => {
    const backend = fakeBackend();
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: 0,
      backend,
    });

    expect(session.isWatching()).toBe(false);
    await session.acquireClient();
    expect(session.isWatching()).toBe(true);
    expect(session.clientCount()).toBe(1);

    await session.releaseClient();
    expect(session.isWatching()).toBe(false);
    expect(session.clientCount()).toBe(0);
  });

  it("keeps the watcher alive while multiple clients are held", async () => {
    const backend = fakeBackend();
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: 0,
      backend,
    });

    await session.acquireClient();
    await session.acquireClient();
    expect(session.clientCount()).toBe(2);

    await session.releaseClient();
    expect(session.isWatching()).toBe(true);

    await session.releaseClient();
    expect(session.isWatching()).toBe(false);
  });

  it("debounces watcher stop for HTTP grace", async () => {
    const graceMs = 25;
    const backend = fakeBackend();
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: graceMs,
      backend,
    });

    await session.acquireClient();
    await session.releaseClient();
    expect(session.isWatching()).toBe(true);

    await Bun.sleep(graceMs + 20);
    expect(session.isWatching()).toBe(false);
  });

  it("cancels scheduled stop when a new client acquires during grace", async () => {
    const graceMs = 25;
    const backend = fakeBackend();
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: graceMs,
      backend,
    });

    await session.acquireClient();
    await session.releaseClient();
    await Bun.sleep(10);
    await session.acquireClient();
    await Bun.sleep(graceMs + 20);
    expect(session.isWatching()).toBe(true);
    await session.forceStop();
  });

  it("rolls back client count when ensureStarted fails", async () => {
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: 0,
      backend: {
        start() {
          throw new Error("start failed");
        },
        async stop() {},
      },
    });

    await expect(session.acquireClient()).rejects.toThrow("start failed");
    expect(session.clientCount()).toBe(0);
    expect(session.isWatching()).toBe(false);
  });
});

describe("bindWatchClientRelease", () => {
  it("releases once on finish or close", async () => {
    const backend = fakeBackend();
    const session = createManagedWatchSession({
      root: "/tmp",
      excludeDirNames: new Set(["node_modules"]),
      recipesWatchPrefix: ".codemap/recipes/",
      debounceMs: 0,
      onChange: () => {},
      releaseGraceMs: 0,
      backend,
    });
    await session.acquireClient();

    const res = new EventEmitter();
    bindWatchClientRelease(res, session);
    res.emit("finish");
    res.emit("close");
    await Bun.sleep(0);
    expect(session.clientCount()).toBe(0);
    expect(session.isWatching()).toBe(false);
  });
});
