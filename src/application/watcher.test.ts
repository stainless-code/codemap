import { describe, expect, it } from "bun:test";

import {
  _resetWatchStateForTests,
  createDebouncer,
  isWatchActive,
  runWatchLoop,
  shouldIndexPath,
} from "./watcher";
import type { WatchBackend } from "./watcher";

describe("shouldIndexPath", () => {
  const exclude = new Set(["node_modules", ".git", "dist", "build"]);

  it("accepts indexed extensions", () => {
    for (const p of [
      "src/foo.ts",
      "src/foo.tsx",
      "src/foo.js",
      "src/foo.jsx",
      "src/foo.mts",
      "src/foo.cts",
      "src/foo.mjs",
      "src/foo.cjs",
      "src/foo.css",
    ]) {
      expect(shouldIndexPath(p, exclude)).toBe(true);
    }
  });

  it("rejects unindexed extensions", () => {
    for (const p of [
      "README.md",
      "package.json",
      "tsconfig.json",
      "src/foo.txt",
      "src/foo.png",
    ]) {
      expect(shouldIndexPath(p, exclude)).toBe(false);
    }
  });

  it("accepts project-local recipe sql + md", () => {
    expect(shouldIndexPath(".codemap/recipes/foo.sql", exclude)).toBe(true);
    expect(shouldIndexPath(".codemap/recipes/foo.md", exclude)).toBe(true);
  });

  it("rejects .codemap.db and other dot-prefixed files", () => {
    // The DB itself + WAL / SHM live under .codemap/ (or the root
    // depending on config) — never reindex on those.
    expect(shouldIndexPath(".codemap/codemap.db", exclude)).toBe(false);
    expect(shouldIndexPath(".codemap/codemap.db-wal", exclude)).toBe(false);
  });

  it("rejects paths inside excluded dirs", () => {
    expect(shouldIndexPath("node_modules/foo/bar.ts", exclude)).toBe(false);
    expect(shouldIndexPath("dist/bundle.js", exclude)).toBe(false);
    expect(shouldIndexPath(".git/HEAD", exclude)).toBe(false);
    // Nested deep:
    expect(shouldIndexPath("packages/a/node_modules/b/c.ts", exclude)).toBe(
      false,
    );
  });

  it("rejects empty / dot path", () => {
    expect(shouldIndexPath("", exclude)).toBe(false);
    expect(shouldIndexPath(".", exclude)).toBe(false);
  });

  it("excludeDirNames is exact-match (substring not enough)", () => {
    // 'distill' should NOT be excluded just because 'dist' is.
    expect(shouldIndexPath("distill/foo.ts", exclude)).toBe(true);
  });
});

describe("createDebouncer", () => {
  it("coalesces a burst into one flush", async () => {
    const flushes: ReadonlySet<string>[] = [];
    const d = createDebouncer((paths) => flushes.push(paths), 30);
    d.trigger("a.ts");
    d.trigger("b.ts");
    d.trigger("a.ts"); // dedup
    expect(d.pendingSize()).toBe(2);
    await new Promise((r) => setTimeout(r, 80));
    expect(flushes).toHaveLength(1);
    expect([...flushes[0]!].sort()).toEqual(["a.ts", "b.ts"]);
    expect(d.pendingSize()).toBe(0);
  });

  it("resets the timer on every trigger (sliding window)", async () => {
    const flushes: ReadonlySet<string>[] = [];
    const d = createDebouncer((paths) => flushes.push(paths), 50);
    d.trigger("a.ts");
    await new Promise((r) => setTimeout(r, 30));
    d.trigger("b.ts"); // resets — should flush ~50ms after THIS trigger
    await new Promise((r) => setTimeout(r, 30));
    expect(flushes).toHaveLength(0); // not yet
    await new Promise((r) => setTimeout(r, 40));
    expect(flushes).toHaveLength(1);
    expect([...flushes[0]!].sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("flushNow forces immediate flush + clears pending", () => {
    const flushes: ReadonlySet<string>[] = [];
    const d = createDebouncer((paths) => flushes.push(paths), 999_999);
    d.trigger("a.ts");
    d.flushNow();
    expect(flushes).toHaveLength(1);
    expect(d.pendingSize()).toBe(0);
  });

  it("flushNow on empty pending is a no-op", () => {
    const flushes: ReadonlySet<string>[] = [];
    const d = createDebouncer((paths) => flushes.push(paths), 999_999);
    d.flushNow();
    expect(flushes).toHaveLength(0);
  });

  it("reset clears pending without firing", () => {
    const flushes: ReadonlySet<string>[] = [];
    const d = createDebouncer((paths) => flushes.push(paths), 999_999);
    d.trigger("a.ts");
    d.reset();
    expect(d.pendingSize()).toBe(0);
    expect(flushes).toHaveLength(0);
  });
});

describe("runWatchLoop — backend dispatch + path filter", () => {
  // Fake backend so we can drive events deterministically without real
  // chokidar / fs-watch flakiness in CI containers.
  function fakeBackend(): WatchBackend & {
    fire: (kind: "add" | "change" | "unlink", abs: string) => void;
    started: boolean;
    stopped: boolean;
  } {
    let onEvent:
      | ((k: "add" | "change" | "unlink", p: string) => void)
      | undefined;
    return {
      started: false,
      stopped: false,
      start(opts) {
        this.started = true;
        onEvent = opts.onEvent;
      },
      async stop() {
        this.stopped = true;
      },
      fire(kind, abs) {
        if (onEvent !== undefined) onEvent(kind, abs);
      },
    };
  }

  const exclude = new Set(["node_modules", ".git", "dist"]);

  it("invokes onChange with project-relative POSIX paths after debounce", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 20,
      backend,
    });

    expect(backend.started).toBe(true);
    backend.fire("change", "/tmp/proj/src/a.ts");
    backend.fire("add", "/tmp/proj/src/b.tsx");

    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    expect([...calls[0]!].sort()).toEqual(["src/a.ts", "src/b.tsx"]);

    await handle.stop();
    expect(backend.stopped).toBe(true);
  });

  it("filters out unindexed extensions BEFORE debouncing", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 20,
      backend,
    });

    backend.fire("change", "/tmp/proj/README.md");
    backend.fire("change", "/tmp/proj/package.json");
    backend.fire("add", "/tmp/proj/.codemap/codemap.db");

    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(0); // no indexable paths → no flush

    await handle.stop();
  });

  it("filters out paths inside excluded dirs", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 20,
      backend,
    });

    backend.fire("change", "/tmp/proj/node_modules/lib/foo.ts");
    backend.fire("change", "/tmp/proj/dist/bundle.js");
    backend.fire("change", "/tmp/proj/src/real.ts"); // this one should land

    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    expect([...calls[0]!]).toEqual(["src/real.ts"]);

    await handle.stop();
  });

  it("flushes pending on stop", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 999_999, // never auto-flush
      backend,
    });

    backend.fire("change", "/tmp/proj/src/a.ts");
    expect(calls).toHaveLength(0); // debounce hasn't fired

    await handle.stop();
    expect(calls).toHaveLength(1);
    expect([...calls[0]!]).toEqual(["src/a.ts"]);
  });

  it("dedups the same path within a burst", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 20,
      backend,
    });

    backend.fire("add", "/tmp/proj/src/a.ts");
    backend.fire("change", "/tmp/proj/src/a.ts");
    backend.fire("change", "/tmp/proj/src/a.ts");

    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    expect([...calls[0]!]).toEqual(["src/a.ts"]);

    await handle.stop();
  });

  it("toggles isWatchActive on start + stop (used by handleAudit to skip prelude)", async () => {
    _resetWatchStateForTests();
    expect(isWatchActive()).toBe(false);
    const backend = fakeBackend();
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: () => undefined,
      debounceMs: 20,
      backend,
    });
    expect(isWatchActive()).toBe(true);
    await handle.stop();
    expect(isWatchActive()).toBe(false);
  });

  it("treats unlink as a path requiring reindex (caller handles deletes)", async () => {
    const backend = fakeBackend();
    const calls: ReadonlySet<string>[] = [];
    const handle = runWatchLoop({
      root: "/tmp/proj",
      excludeDirNames: exclude,
      onChange: (paths) => {
        calls.push(paths);
      },
      debounceMs: 20,
      backend,
    });

    backend.fire("unlink", "/tmp/proj/src/gone.ts");
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    expect([...calls[0]!]).toEqual(["src/gone.ts"]);

    await handle.stop();
  });
});
