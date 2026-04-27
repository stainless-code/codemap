import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { hashContent } from "../hash";
import { initCodemap } from "../runtime";
import { computeValidateRows, parseValidateRest } from "./cmd-validate";
import type { ValidateRow } from "./cmd-validate";

let tmpRoot = "";

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "codemap-validate-"));
  mkdirSync(join(tmpRoot, "src"), { recursive: true });
  initCodemap(resolveCodemapConfig(tmpRoot, {}));
  const db = openDb();
  db.run(
    "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, content_hash TEXT, size INTEGER, line_count INTEGER, language TEXT, last_modified INTEGER, indexed_at INTEGER) STRICT",
  );
  closeDb(db, { readonly: false });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function seedIndex(rows: { path: string; content_hash: string }[]) {
  const db = openDb();
  try {
    for (const r of rows) {
      db.run(
        "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, 0, 0, 'ts', 0, 0)",
        [r.path, r.content_hash],
      );
    }
  } finally {
    closeDb(db, { readonly: false });
  }
}

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb();
  try {
    return fn(db);
  } finally {
    closeDb(db, { readonly: true });
  }
}

describe("parseValidateRest", () => {
  it("returns help for --help", () => {
    expect(parseValidateRest(["validate", "--help"]).kind).toBe("help");
    expect(parseValidateRest(["validate", "-h"]).kind).toBe("help");
  });

  it("parses no args (check all)", () => {
    expect(parseValidateRest(["validate"])).toEqual({
      kind: "run",
      paths: [],
      json: false,
    });
  });

  it("parses --json with paths", () => {
    expect(parseValidateRest(["validate", "--json", "a.ts", "b.ts"])).toEqual({
      kind: "run",
      paths: ["a.ts", "b.ts"],
      json: true,
    });
  });

  it("rejects unknown option", () => {
    const r = parseValidateRest(["validate", "--nope"]);
    expect(r.kind).toBe("error");
  });
});

describe("computeValidateRows", () => {
  it("returns empty when everything matches", () => {
    const content = "export const a = 1\n";
    writeFileSync(join(tmpRoot, "src/a.ts"), content);
    seedIndex([{ path: "src/a.ts", content_hash: hashContent(content) }]);
    const rows = withDb((db) => computeValidateRows(db, tmpRoot, []));
    expect(rows).toEqual([]);
  });

  it("flags stale entries", () => {
    const old = "export const a = 1\n";
    writeFileSync(join(tmpRoot, "src/a.ts"), "export const a = 2\n");
    seedIndex([{ path: "src/a.ts", content_hash: hashContent(old) }]);
    const rows = withDb((db) => computeValidateRows(db, tmpRoot, []));
    expect(rows).toEqual([{ path: "src/a.ts", status: "stale" }]);
  });

  it("flags missing files", () => {
    seedIndex([{ path: "src/gone.ts", content_hash: "deadbeef" }]);
    const rows = withDb((db) => computeValidateRows(db, tmpRoot, []));
    expect(rows).toEqual([{ path: "src/gone.ts", status: "missing" }]);
  });

  it("flags unindexed files when explicit paths are passed", () => {
    writeFileSync(join(tmpRoot, "src/new.ts"), "export const x = 0\n");
    const rows = withDb((db) =>
      computeValidateRows(db, tmpRoot, ["src/new.ts"]),
    );
    expect(rows).toEqual([{ path: "src/new.ts", status: "unindexed" }]);
  });

  it("dedupes paths and sorts by path", () => {
    writeFileSync(join(tmpRoot, "src/a.ts"), "v2\n");
    writeFileSync(join(tmpRoot, "src/b.ts"), "v2\n");
    seedIndex([
      { path: "src/a.ts", content_hash: hashContent("v1\n") },
      { path: "src/b.ts", content_hash: hashContent("v1\n") },
    ]);
    const rows = withDb((db) =>
      computeValidateRows(db, tmpRoot, ["src/b.ts", "src/a.ts", "src/a.ts"]),
    );
    expect(rows.map((r: ValidateRow) => r.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
