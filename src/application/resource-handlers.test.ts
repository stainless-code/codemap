import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  _resetResourceCachesForTests,
  listResources,
  readResource,
} from "./resource-handlers";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "codemap-resource-test-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  _resetResourceCachesForTests();

  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES
         ('src/foo.ts', 'h1', 100, 30, 'ts', 1, 1),
         ('src/bar.ts', 'h2', 80, 20, 'ts', 1, 1),
         ('src/legacy/foo.ts', 'h3', 50, 15, 'ts', 1, 1)`,
    );
    db.run(
      `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
       VALUES
         ('src/foo.ts', 'foo', 'function', 5, 15, 'function foo(): void', 1, 0),
         ('src/foo.ts', 'helper', 'function', 20, 25, 'function helper(): string', 0, 0),
         ('src/legacy/foo.ts', 'foo', 'function', 1, 50, 'function foo(arg: string): number', 0, 0)`,
    );
    db.run(
      `INSERT INTO imports (file_path, source, resolved_path, specifiers, is_type_only, line_number)
       VALUES ('src/foo.ts', './bar', 'src/bar.ts', '["bar"]', 0, 1)`,
    );
    db.run(
      `INSERT INTO exports (file_path, name, kind, is_default)
       VALUES ('src/foo.ts', 'foo', 'value', 0)`,
    );
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
  _resetResourceCachesForTests();
});

describe("readResource — codemap://files/{path}", () => {
  it("returns per-file roll-up with symbols / imports / exports", () => {
    const r = readResource("codemap://files/src/foo.ts");
    expect(r).toBeDefined();
    expect(r?.mimeType).toBe("application/json");
    const payload = JSON.parse(r!.text);
    expect(payload.path).toBe("src/foo.ts");
    expect(payload.language).toBe("ts");
    expect(payload.symbols).toHaveLength(2);
    expect(payload.imports).toHaveLength(1);
    expect(payload.imports[0].specifiers).toEqual(["bar"]);
    expect(payload.exports).toHaveLength(1);
    expect(payload.coverage).toBeNull();
  });

  it("returns undefined when path not in the index", () => {
    expect(readResource("codemap://files/no-such-file.ts")).toBeUndefined();
  });

  it("URI-decodes the path", () => {
    const r = readResource("codemap://files/src%2Flegacy%2Ffoo.ts");
    expect(r).toBeDefined();
    expect(JSON.parse(r!.text).path).toBe("src/legacy/foo.ts");
  });
});

describe("readResource — codemap://symbols/{name}", () => {
  it("returns single match envelope when the name is unique", () => {
    const r = readResource("codemap://symbols/helper");
    expect(r).toBeDefined();
    const payload = JSON.parse(r!.text);
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0].name).toBe("helper");
    expect(payload.disambiguation).toBeUndefined();
  });

  it("returns disambiguation envelope on multi-match", () => {
    const r = readResource("codemap://symbols/foo");
    expect(r).toBeDefined();
    const payload = JSON.parse(r!.text);
    expect(payload.matches).toHaveLength(2);
    expect(payload.disambiguation).toBeDefined();
    expect(payload.disambiguation.n).toBe(2);
    expect(payload.disambiguation.files).toContain("src/foo.ts");
    expect(payload.disambiguation.files).toContain("src/legacy/foo.ts");
  });

  it("filters by ?in=<path-prefix>", () => {
    const r = readResource("codemap://symbols/foo?in=src/legacy");
    expect(r).toBeDefined();
    const payload = JSON.parse(r!.text);
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0].file_path).toBe("src/legacy/foo.ts");
  });

  it("returns empty matches for unknown name", () => {
    const r = readResource("codemap://symbols/no-such-symbol");
    expect(r).toBeDefined();
    expect(JSON.parse(r!.text).matches).toEqual([]);
  });

  it("returns undefined when name is empty", () => {
    expect(readResource("codemap://symbols/")).toBeUndefined();
  });
});

describe("listResources", () => {
  it("advertises the new files / symbols templates", () => {
    const list = listResources();
    const uris = list.map((r) => r.uri);
    expect(uris).toContain("codemap://files/{path}");
    expect(uris).toContain("codemap://symbols/{name}");
  });
});
