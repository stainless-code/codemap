import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb, setMeta } from "../db";
import { initCodemap } from "../runtime";
import { buildContextEnvelope } from "./context-engine";
import * as indexEngine from "./index-engine";
import { computeIndexFreshness } from "./index-freshness";
import { _resetWatchStateForTests, runWatchLoop } from "./watcher";
import type { WatchBackend } from "./watcher";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "index-freshness-"));
  mkdirSync(join(benchDir, ".codemap"), { recursive: true });
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  _resetWatchStateForTests();
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
  _resetWatchStateForTests();
});

function withEmptyDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb();
  try {
    createTables(db);
    return fn(db);
  } finally {
    closeDb(db);
  }
}

function fakeBackend(): WatchBackend & {
  fire: (kind: "add" | "change" | "unlink", abs: string) => void;
} {
  let onEvent:
    | ((k: "add" | "change" | "unlink", p: string) => void)
    | undefined;
  return {
    start(opts) {
      onEvent = opts.onEvent;
    },
    async stop() {},
    fire(kind, abs) {
      onEvent?.(kind, abs);
    },
  };
}

describe("computeIndexFreshness", () => {
  it("reports no warning when HEAD matches last_indexed_commit", () => {
    const head = "abc123def456789012345678901234567890abcd";
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue(
      head,
    );

    try {
      withEmptyDb((db) => {
        setMeta(db, "last_indexed_commit", head);
        const f = computeIndexFreshness(db);
        expect(f.commit_drift).toBe(false);
        expect(f.warning).toBeNull();
        expect(f.head_commit).toBe(head);
      });
    } finally {
      revParse.mockRestore();
    }
  });

  it("warns on commit drift", () => {
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    try {
      withEmptyDb((db) => {
        setMeta(
          db,
          "last_indexed_commit",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        const f = computeIndexFreshness(db);
        expect(f.commit_drift).toBe(true);
        expect(f.warning).toContain("HEAD is bbbbbbb");
      });
    } finally {
      revParse.mockRestore();
    }
  });

  it("reports pending_sync when the watcher debouncer has queued paths", async () => {
    spyOn(indexEngine, "getCurrentCommit").mockReturnValue("");
    mkdirSync(join(benchDir, "src"), { recursive: true });
    const backend = fakeBackend();
    const handle = runWatchLoop({
      root: benchDir,
      excludeDirNames: new Set(["node_modules", ".git", "dist"]),
      onChange: () => {},
      debounceMs: 60_000,
      backend,
    });

    backend.fire("change", join(benchDir, "src/a.ts"));

    withEmptyDb((db) => {
      const f = computeIndexFreshness(db);
      expect(f.pending_sync).toBe(true);
      expect(f.pending_paths).toBe(1);
      expect(f.warning).toContain("pending");
    });

    await handle.stop();
  });
});

describe("buildContextEnvelope", () => {
  it("includes index_freshness with disk drift opt-in", () => {
    const head = "cccccccccccccccccccccccccccccccccccccccc";
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue(
      head,
    );
    const changedFiles = spyOn(indexEngine, "getChangedFiles").mockReturnValue({
      changed: [],
      deleted: [],
      existingPaths: new Set(),
      sourceCache: new Map(),
      existingHashes: new Map(),
    });

    try {
      withEmptyDb((db) => {
        setMeta(db, "last_indexed_commit", head);
        const envelope = buildContextEnvelope(db, benchDir, {
          compact: true,
          intent: null,
        });
        expect(envelope.index_freshness.head_commit).toBe(head);
        expect(envelope.index_freshness.disk_ahead_of_index).toBe(false);
        expect(envelope.index_freshness.warning).toBeNull();
      });
    } finally {
      revParse.mockRestore();
      changedFiles.mockRestore();
    }
  });
});
