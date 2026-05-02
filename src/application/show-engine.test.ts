import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { findSymbolsByName } from "./show-engine";

let db: CodemapDatabase;

beforeEach(() => {
  db = openCodemapDatabase(":memory:");
  createTables(db);
  // Seed a `files` row first so `symbols.file_path` foreign keys resolve.
  db.run(
    "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)",
    [
      "src/cli/cmd-show.ts",
      "h1",
      100,
      30,
      "ts",
      1,
      1,
      "src/legacy/foo.ts",
      "h2",
      80,
      20,
      "ts",
      1,
      1,
      "src/test/fixtures.ts",
      "h3",
      50,
      15,
      "ts",
      1,
      1,
    ],
  );
  // Three symbols named `foo` across two files + a kind variation.
  db.run(
    `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
     VALUES
       ('src/cli/cmd-show.ts', 'foo', 'function', 5, 15, 'function foo(): void', 1, 0),
       ('src/legacy/foo.ts',   'foo', 'function', 1, 50, 'function foo(arg: string): number', 0, 0),
       ('src/test/fixtures.ts','foo', 'const',    3, 3,  'const foo = 42',                    1, 0),
       ('src/cli/cmd-show.ts', 'bar', 'function', 20, 25,'function bar(): string',           1, 0)`,
  );
});

afterEach(() => {
  db.close();
});

describe("findSymbolsByName", () => {
  it("returns single match for a unique name", () => {
    const r = findSymbolsByName(db, { name: "bar" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: "bar",
      kind: "function",
      file_path: "src/cli/cmd-show.ts",
      line_start: 20,
      line_end: 25,
    });
  });

  it("returns empty array for unknown name", () => {
    expect(findSymbolsByName(db, { name: "no-such-symbol" })).toEqual([]);
  });

  it("returns all matches for an ambiguous name (deterministic order)", () => {
    const r = findSymbolsByName(db, { name: "foo" });
    expect(r).toHaveLength(3);
    // Ordered by file_path ASC, line_start ASC.
    expect(r.map((m) => m.file_path)).toEqual([
      "src/cli/cmd-show.ts",
      "src/legacy/foo.ts",
      "src/test/fixtures.ts",
    ]);
  });

  it("filters by kind when set", () => {
    const r = findSymbolsByName(db, { name: "foo", kind: "const" });
    expect(r).toHaveLength(1);
    expect(r[0]!.file_path).toBe("src/test/fixtures.ts");
  });

  it("kind=function narrows ambiguous name to 2 matches", () => {
    const r = findSymbolsByName(db, { name: "foo", kind: "function" });
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.file_path)).toEqual([
      "src/cli/cmd-show.ts",
      "src/legacy/foo.ts",
    ]);
  });

  it("inPath as directory (no extension) treats as prefix", () => {
    const r = findSymbolsByName(db, { name: "foo", inPath: "src/cli" });
    expect(r).toHaveLength(1);
    expect(r[0]!.file_path).toBe("src/cli/cmd-show.ts");
  });

  it("inPath with trailing slash treats as prefix", () => {
    const r = findSymbolsByName(db, { name: "foo", inPath: "src/legacy/" });
    expect(r).toHaveLength(1);
    expect(r[0]!.file_path).toBe("src/legacy/foo.ts");
  });

  it("inPath with file extension treats as exact match", () => {
    const r = findSymbolsByName(db, {
      name: "foo",
      inPath: "src/test/fixtures.ts",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe("const");
  });

  it("inPath exact-match misses when path doesn't match", () => {
    const r = findSymbolsByName(db, {
      name: "foo",
      inPath: "src/test/other.ts",
    });
    expect(r).toEqual([]);
  });

  it("inPath + kind compose (AND, not OR)", () => {
    const r = findSymbolsByName(db, {
      name: "foo",
      kind: "function",
      inPath: "src/cli",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.file_path).toBe("src/cli/cmd-show.ts");
  });

  it("returns kind/visibility/parent_name fields", () => {
    const r = findSymbolsByName(db, { name: "bar" });
    expect(r[0]).toMatchObject({
      kind: "function",
      visibility: null,
      parent_name: null,
      is_exported: 1,
    });
  });

  it("name match is case-sensitive", () => {
    expect(findSymbolsByName(db, { name: "FOO" })).toEqual([]);
    expect(findSymbolsByName(db, { name: "Foo" })).toEqual([]);
  });
});
