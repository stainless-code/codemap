import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import { printQueryResult } from "./index-engine";
import { executeQuery } from "./query-engine";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "index-engine-query-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(join(benchDir, "src", "a.ts"), "export const A = 1;\n");
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'h1', 10, 1, 'typescript', 1, 1), ('src/b.ts', 'h2', 10, 1, 'typescript', 1, 1), ('docs/c.md', 'h3', 5, 1, 'markdown', 1, 1)",
    );
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

describe("printQueryResult", () => {
  it("rejects DML — read-only enforcement via PRAGMA query_only", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const code = printQueryResult(
      "DELETE FROM files WHERE language='markdown'",
      { json: true },
    );
    expect(code).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: expect.any(String),
    });
    log.mockRestore();

    const after = executeQuery({
      sql: "SELECT COUNT(*) AS n FROM files WHERE language='markdown'",
      root: benchDir,
    });
    expect(after).toEqual([{ n: 1 }]);
  });

  it("rejects DDL — DROP TABLE blocked by query_only", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const code = printQueryResult("DROP TABLE files", { json: true });
    expect(code).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: expect.any(String),
    });
    log.mockRestore();

    const after = executeQuery({
      sql: "SELECT COUNT(*) AS n FROM files",
      root: benchDir,
    });
    expect(after).toEqual([{ n: 3 }]);
  });

  it("returns SELECT rows on success", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const code = printQueryResult("SELECT path FROM files ORDER BY path", {
      json: true,
    });
    expect(code).toBe(0);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual([
      { path: "docs/c.md" },
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    log.mockRestore();
  });
});
