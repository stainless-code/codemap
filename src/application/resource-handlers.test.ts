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

describe("readResource — codemap://recipes (Slice 3 recency inline)", () => {
  it("includes last_run_at + run_count fields on every entry", () => {
    const r = readResource("codemap://recipes");
    expect(r).toBeDefined();
    const entries = JSON.parse(r!.text) as Array<{
      id: string;
      last_run_at: number | null;
      run_count: number;
    }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect("last_run_at" in entry).toBe(true);
      expect("run_count" in entry).toBe(true);
      expect(entry.run_count).toBe(0);
      expect(entry.last_run_at).toBeNull();
    }
  });

  it("populates real recency for recipes that have been run", () => {
    // Use a fresh timestamp — loadRecipeRecency lazily prunes anything
    // older than 90 days (Q3 Resolution). Seed recipe_recency directly;
    // bypasses the runtime singleton's bootstrap (already initialised
    // by beforeEach).
    const ts = Date.now();
    const db = openDb();
    try {
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, ?)",
        ["fan-out", ts, 7],
      );
    } finally {
      closeDb(db);
    }

    const r = readResource("codemap://recipes");
    const entries = JSON.parse(r!.text) as Array<{
      id: string;
      last_run_at: number | null;
      run_count: number;
    }>;
    const fanOut = entries.find((e) => e.id === "fan-out");
    expect(fanOut).toBeDefined();
    expect(fanOut!.last_run_at).toBe(ts);
    expect(fanOut!.run_count).toBe(7);
    // Untouched recipes still null/0.
    const barrel = entries.find((e) => e.id === "barrel-files");
    expect(barrel?.last_run_at).toBeNull();
    expect(barrel?.run_count).toBe(0);
  });

  it("reads live every call (no stale cache between reads)", () => {
    const r1 = readResource("codemap://recipes");
    const before = (
      JSON.parse(r1!.text) as Array<{ id: string; run_count: number }>
    ).find((e) => e.id === "fan-in");
    expect(before?.run_count).toBe(0);

    const ts = Date.now();
    const db = openDb();
    try {
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, ?)",
        ["fan-in", ts, 3],
      );
    } finally {
      closeDb(db);
    }

    const r2 = readResource("codemap://recipes");
    const after = (
      JSON.parse(r2!.text) as Array<{ id: string; run_count: number }>
    ).find((e) => e.id === "fan-in");
    expect(after?.run_count).toBe(3);
  });
});

describe("readResource — codemap://recipes/{id} (Slice 3 recency inline)", () => {
  it("returns entry with last_run_at + run_count fields", () => {
    const ts = Date.now();
    const db = openDb();
    try {
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, ?)",
        ["fan-out", ts, 4],
      );
    } finally {
      closeDb(db);
    }

    const r = readResource("codemap://recipes/fan-out");
    expect(r).toBeDefined();
    const entry = JSON.parse(r!.text) as {
      id: string;
      last_run_at: number | null;
      run_count: number;
    };
    expect(entry.id).toBe("fan-out");
    expect(entry.last_run_at).toBe(ts);
    expect(entry.run_count).toBe(4);
  });
});
