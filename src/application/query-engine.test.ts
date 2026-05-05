import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import { executeQuery, executeQueryBatch } from "./query-engine";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "query-engine-"));
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

describe("executeQuery", () => {
  it("returns rows array by default", () => {
    const r = executeQuery({
      sql: "SELECT path FROM files ORDER BY path",
      root: benchDir,
    });
    expect(r).toEqual([
      { path: "docs/c.md" },
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
  });

  it("returns {count} under summary", () => {
    const r = executeQuery({
      sql: "SELECT path FROM files",
      summary: true,
      root: benchDir,
    });
    expect(r).toEqual({ count: 3 });
  });

  it("binds recipe params positionally", () => {
    const r = executeQuery({
      sql: "SELECT path FROM files WHERE language = ? AND path LIKE ? ORDER BY path",
      bindValues: ["typescript", "src/%"],
      root: benchDir,
    });
    expect(r).toEqual([{ path: "src/a.ts" }, { path: "src/b.ts" }]);
  });

  it("returns {group_by, groups} under group_by", () => {
    const r = executeQuery({
      sql: "SELECT path FROM files",
      groupBy: "directory",
      root: benchDir,
    });
    expect(r).toMatchObject({ group_by: "directory" });
  });

  it("returns {error} on invalid SQL instead of throwing", () => {
    const r = executeQuery({
      sql: "SELECT * FROM nonexistent_table",
      root: benchDir,
    });
    expect(r).toMatchObject({ error: expect.any(String) });
  });

  it("filters rows by changedFiles when set", () => {
    const r = executeQuery({
      sql: "SELECT path FROM files",
      changedFiles: new Set(["src/a.ts"]),
      root: benchDir,
    });
    expect(r).toEqual([{ path: "src/a.ts" }]);
  });

  it("rejects DML — read-only enforcement via PRAGMA query_only", () => {
    const r = executeQuery({
      sql: "DELETE FROM files WHERE language='markdown'",
      root: benchDir,
    });
    expect(r).toMatchObject({ error: expect.any(String) });
    // Confirm the row wasn't actually deleted.
    const after = executeQuery({
      sql: "SELECT COUNT(*) AS n FROM files WHERE language='markdown'",
      root: benchDir,
    });
    expect(after).toEqual([{ n: 1 }]);
  });

  it("rejects DDL — DROP TABLE blocked by query_only", () => {
    const r = executeQuery({
      sql: "DROP TABLE files",
      root: benchDir,
    });
    expect(r).toMatchObject({ error: expect.any(String) });
    // Confirm the table still exists.
    const after = executeQuery({
      sql: "SELECT COUNT(*) AS n FROM files",
      root: benchDir,
    });
    expect(after).toEqual([{ n: 3 }]);
  });
});

describe("executeQueryBatch", () => {
  it("runs N statements and returns N results", () => {
    const r = executeQueryBatch({
      statements: [
        {
          sql: "SELECT path FROM files WHERE language='typescript' ORDER BY path",
        },
        { sql: "SELECT path FROM files WHERE language='markdown'" },
      ],
      root: benchDir,
    });
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual([{ path: "src/a.ts" }, { path: "src/b.ts" }]);
    expect(r[1]).toEqual([{ path: "docs/c.md" }]);
  });

  it("respects per-statement summary override", () => {
    const r = executeQueryBatch({
      statements: [
        { sql: "SELECT path FROM files" },
        { sql: "SELECT path FROM files", summary: true },
      ],
      root: benchDir,
    });
    expect(Array.isArray(r[0])).toBe(true);
    expect(r[1]).toEqual({ count: 3 });
  });

  it("isolates errors — failed statement returns {error} but siblings succeed", () => {
    const r = executeQueryBatch({
      statements: [
        { sql: "SELECT path FROM files WHERE language='markdown'" },
        { sql: "SELECT * FROM nonexistent" },
        { sql: "SELECT path FROM files WHERE language='typescript'" },
      ],
      root: benchDir,
    });
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual([{ path: "docs/c.md" }]);
    expect(r[1]).toMatchObject({ error: expect.any(String) });
    expect(Array.isArray(r[2])).toBe(true);
    expect((r[2] as unknown[]).length).toBe(2);
  });
});
