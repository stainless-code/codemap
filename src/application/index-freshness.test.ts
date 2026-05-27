import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import * as dbModule from "../db";
import { closeDb, createTables, openDb, setMeta } from "../db";
import { initCodemap } from "../runtime";
import { buildContextEnvelope } from "./context-engine";
import * as indexEngine from "./index-engine";
import {
  computeIndexFreshness,
  mergeIndexFreshnessIntoJsonPayload,
  resolveTransportIndexFreshness,
  warnIndexFreshnessToStderr,
} from "./index-freshness";
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

  it("reports history_incompatible when getChangedFiles returns null", () => {
    spyOn(indexEngine, "getCurrentCommit").mockReturnValue("d".repeat(40));
    const changedFiles = spyOn(indexEngine, "getChangedFiles").mockReturnValue(
      null,
    );

    try {
      withEmptyDb((db) => {
        setMeta(db, "last_indexed_commit", "e".repeat(40));
        const f = computeIndexFreshness(db, { include_disk_drift: true });
        expect(f.history_incompatible).toBe(true);
        expect(f.warning).toContain("Git history is incompatible");
      });
    } finally {
      changedFiles.mockRestore();
    }
  });

  it("reports disk-ahead with unindexed change count", () => {
    const head = "f".repeat(40);
    spyOn(indexEngine, "getCurrentCommit").mockReturnValue(head);
    spyOn(indexEngine, "getChangedFiles").mockReturnValue({
      changed: ["src/a.ts", "src/b.ts"],
      deleted: ["src/c.ts"],
      existingPaths: new Set(),
      sourceCache: new Map(),
      existingHashes: new Map(),
    });

    withEmptyDb((db) => {
      setMeta(db, "last_indexed_commit", head);
      const f = computeIndexFreshness(db, { include_disk_drift: true });
      expect(f.disk_ahead_of_index).toBe(true);
      expect(f.unindexed_change_count).toBe(3);
      expect(f.warning).toContain("3 unindexed change");
    });
  });
});

describe("resolveTransportIndexFreshness", () => {
  it("reuses embedded index_freshness without opening the DB", () => {
    const embedded = {
      head_commit: null,
      last_indexed_commit: null,
      commit_drift: false,
      watch_active: false,
      pending_sync: false,
      pending_paths: 0,
      reindex_in_flight: false,
      warning: null,
    };
    const openDbSpy = spyOn(dbModule, "openDb");
    try {
      expect(
        resolveTransportIndexFreshness({ index_freshness: embedded }),
      ).toBe(embedded);
      expect(openDbSpy).not.toHaveBeenCalled();
    } finally {
      openDbSpy.mockRestore();
    }
  });
});

describe("mergeIndexFreshnessIntoJsonPayload", () => {
  const freshness = {
    head_commit: "a".repeat(40),
    last_indexed_commit: "b".repeat(40),
    commit_drift: true,
    watch_active: false,
    pending_sync: false,
    pending_paths: 0,
    reindex_in_flight: false,
    warning: "drift",
  };

  it("leaves array payloads unchanged", () => {
    const rows = [{ path: "src/a.ts" }];
    expect(mergeIndexFreshnessIntoJsonPayload(rows, freshness)).toBe(rows);
  });

  it("merges into object payloads", () => {
    expect(mergeIndexFreshnessIntoJsonPayload({ count: 3 }, freshness)).toEqual(
      { count: 3, index_freshness: freshness },
    );
  });

  it("skips when index_freshness is already present", () => {
    const payload = { index_freshness: freshness, file_count: 1 };
    expect(mergeIndexFreshnessIntoJsonPayload(payload, freshness)).toBe(
      payload,
    );
  });
});

describe("warnIndexFreshnessToStderr", () => {
  it("logs a one-line warning when freshness concerns remain", () => {
    const errLog = spyOn(console, "error").mockImplementation(() => {});
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
        warnIndexFreshnessToStderr("codemap mcp");
      });
      expect(errLog).toHaveBeenCalledWith(
        expect.stringContaining("codemap mcp:"),
      );
    } finally {
      errLog.mockRestore();
      revParse.mockRestore();
    }
  });

  it("stays silent when warning is null", () => {
    const head = "cccccccccccccccccccccccccccccccccccccccc";
    const errLog = spyOn(console, "error").mockImplementation(() => {});
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
        warnIndexFreshnessToStderr("codemap serve");
      });
      expect(errLog).not.toHaveBeenCalled();
    } finally {
      errLog.mockRestore();
      revParse.mockRestore();
      changedFiles.mockRestore();
    }
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
