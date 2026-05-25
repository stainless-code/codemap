import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { appendIndexError, errorLogPath } from "./error-log";
import {
  IndexLockHeldError,
  acquireIndexLock,
  indexLockPath,
  isStaleLock,
  readIndexLock,
  removeIndexLock,
} from "./index-lock";

function scratchDir(prefix: string): string {
  const base = join(process.cwd(), "fixtures", "tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

describe("index-lock", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("acquireIndexLock creates JSON lock and release removes it", () => {
    dir = scratchDir("index-lock-");
    const release = acquireIndexLock(dir);
    const lockPath = indexLockPath(dir);
    expect(existsSync(lockPath)).toBe(true);
    const payload = readIndexLock(lockPath);
    expect(payload?.pid).toBe(process.pid);
    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("second acquire fails fast while lock is held", () => {
    dir = scratchDir("index-lock-held-");
    const release = acquireIndexLock(dir);
    try {
      expect(() => acquireIndexLock(dir)).toThrow(IndexLockHeldError);
    } finally {
      release();
    }
  });

  it("isStaleLock treats dead PID as stale", () => {
    expect(
      isStaleLock({ pid: 999_999_999, started_at: new Date().toISOString() }),
    ).toBe(true);
  });

  it("removeIndexLock refuses live lock without force", () => {
    dir = scratchDir("index-lock-live-");
    const release = acquireIndexLock(dir);
    try {
      expect(() => removeIndexLock(dir)).toThrow(IndexLockHeldError);
    } finally {
      release();
    }
  });

  it("removeIndexLock with force clears a live lock", () => {
    dir = scratchDir("index-lock-force-");
    const release = acquireIndexLock(dir);
    expect(removeIndexLock(dir, { force: true })).toBe(true);
    expect(existsSync(indexLockPath(dir))).toBe(false);
    release();
  });

  it("auto-steals stale lock on acquire", () => {
    dir = scratchDir("index-lock-stale-");
    const lockPath = indexLockPath(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: 999_999_999,
        started_at: new Date().toISOString(),
      })}\n`,
      "utf-8",
    );
    const release = acquireIndexLock(dir);
    expect(readIndexLock(lockPath)?.pid).toBe(process.pid);
    release();
  });
});

describe("error-log", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("appendIndexError writes TSV lines", () => {
    dir = scratchDir("error-log-");
    appendIndexError(dir, "src/a.ts", "boom");
    const text = readFileSync(errorLogPath(dir), "utf-8");
    expect(text).toContain("\tsrc/a.ts\tboom\n");
  });
});
