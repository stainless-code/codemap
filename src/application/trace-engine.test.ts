import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  composeExploreResult,
  composeNodeResult,
  composeTraceResult,
  dedupeNames,
  executeCallPath,
  executeSymbolNeighborhood,
} from "./trace-engine";

let benchDir: string;

function seedCallGraph() {
  writeFileSync(
    join(benchDir, "src", "a.ts"),
    "export function foo() {\n  return bar();\n}\nexport function bar() {\n  return 1;\n}\n",
  );
  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/a.ts', 'h1', 100, 6, 'typescript', 1, 1)`,
    );
    db.run(
      `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, is_exported, parent_name, visibility)
       VALUES ('foo', 'function', 'src/a.ts', 1, 3, 'foo()', 1, NULL, 'export'),
              ('bar', 'function', 'src/a.ts', 4, 6, 'bar()', 1, NULL, 'export')`,
    );
    db.run(
      `INSERT INTO calls (file_path, caller_name, caller_scope, callee_name, line_start, column_start, column_end)
       VALUES ('src/a.ts', 'foo', 'foo', 'bar', 2, 0, 0)`,
    );
  } finally {
    closeDb(db);
  }
}

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "trace-engine-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  initCodemap(resolveCodemapConfig(benchDir, undefined));
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

describe("executeCallPath", () => {
  it("returns hop rows for a connected call graph", () => {
    seedCallGraph();
    const r = executeCallPath({ root: benchDir, from: "foo", to: "bar" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      expect.objectContaining({
        file_path: "src/a.ts",
        caller_name: "foo",
        callee_name: "bar",
        line_start: 2,
        hop: 1,
        via: "calls",
      }),
    ]);
  });

  it("returns empty path when no route exists", () => {
    seedCallGraph();
    const r = executeCallPath({ root: benchDir, from: "bar", to: "foo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([]);
  });
});

describe("executeSymbolNeighborhood", () => {
  it("returns direct callees and callers", () => {
    seedCallGraph();
    const r = executeSymbolNeighborhood({
      root: benchDir,
      name: "foo",
      depth: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.rows.some((row) => row.name === "bar" && row.edge === "callee"),
    ).toBe(true);
  });
});

describe("composeTraceResult", () => {
  it("attaches snippets for call hops", () => {
    seedCallGraph();
    const path = executeCallPath({ root: benchDir, from: "foo", to: "bar" });
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    const composed = composeTraceResult({
      root: benchDir,
      from: "foo",
      to: "bar",
      path: path.rows,
    });
    expect(composed.path).toHaveLength(1);
    expect(composed.snippets.length).toBeGreaterThanOrEqual(1);
    expect(composed.snippets[0]?.source).toContain("bar");
    expect(composed.truncated).toBe(false);
  });
});

describe("composeExploreResult", () => {
  it("merges neighborhoods for multiple names", () => {
    seedCallGraph();
    const r = composeExploreResult({ root: benchDir, names: ["foo", "bar"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.names).toEqual(["foo", "bar"]);
    expect(r.result.rows.length).toBeGreaterThan(0);
  });
});

function seedHomonymGraph() {
  writeFileSync(
    join(benchDir, "src", "a.ts"),
    "export function helper() {\n  return onlyA();\n}\nfunction onlyA() {\n  return 1;\n}\n",
  );
  writeFileSync(
    join(benchDir, "src", "b.ts"),
    "export function helper() {\n  return onlyB();\n}\nfunction onlyB() {\n  return 2;\n}\n",
  );
  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/a.ts', 'h1', 100, 6, 'typescript', 1, 1),
              ('src/b.ts', 'h2', 100, 6, 'typescript', 1, 1)`,
    );
    db.run(
      `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, is_exported, parent_name, visibility)
       VALUES ('helper', 'function', 'src/a.ts', 1, 3, 'helper()', 1, NULL, 'export'),
              ('onlyA', 'function', 'src/a.ts', 4, 6, 'onlyA()', 0, NULL, NULL),
              ('helper', 'function', 'src/b.ts', 1, 3, 'helper()', 1, NULL, 'export'),
              ('onlyB', 'function', 'src/b.ts', 4, 6, 'onlyB()', 0, NULL, NULL)`,
    );
    db.run(
      `INSERT INTO calls (file_path, caller_name, caller_scope, callee_name, line_start, column_start, column_end)
       VALUES ('src/a.ts', 'helper', 'helper', 'onlyA', 2, 0, 0),
              ('src/b.ts', 'helper', 'helper', 'onlyB', 2, 0, 0)`,
    );
  } finally {
    closeDb(db);
  }
}

describe("composeNodeResult", () => {
  it("returns show envelope and one-hop neighborhood", () => {
    seedCallGraph();
    const r = composeNodeResult({ root: benchDir, name: "foo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.center.matches[0]?.name).toBe("foo");
    expect(r.result.neighborhood.some((row) => row.name === "bar")).toBe(true);
    expect(r.result.snippets).toEqual([]);
  });

  it("includes snippets when requested", () => {
    seedCallGraph();
    const r = composeNodeResult({
      root: benchDir,
      name: "foo",
      includeSnippets: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.snippets.length).toBeGreaterThan(0);
    expect(r.result.snippets.some((s) => s.name === "foo")).toBe(true);
  });

  it("scopes neighborhood to inPath when center is unique", () => {
    seedHomonymGraph();
    const r = composeNodeResult({
      root: benchDir,
      name: "helper",
      inPath: "src/a.ts",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.center.matches).toHaveLength(1);
    expect(r.result.center.matches[0]?.file_path).toBe("src/a.ts");
    expect(r.result.neighborhood.some((row) => row.name === "onlyA")).toBe(
      true,
    );
    expect(r.result.neighborhood.some((row) => row.name === "onlyB")).toBe(
      false,
    );
  });
});

function seedCrossFileCallGraph() {
  writeFileSync(
    join(benchDir, "src", "a.ts"),
    "import { bar } from './b';\nexport function foo() {\n  return bar();\n}\n",
  );
  writeFileSync(
    join(benchDir, "src", "b.ts"),
    "export function bar() {\n  return 1;\n}\n",
  );
  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/a.ts', 'h1', 100, 4, 'typescript', 1, 1),
              ('src/b.ts', 'h2', 100, 3, 'typescript', 1, 1)`,
    );
    db.run(
      `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, is_exported, parent_name, visibility)
       VALUES ('foo', 'function', 'src/a.ts', 2, 4, 'foo()', 1, NULL, 'export'),
              ('bar', 'function', 'src/b.ts', 1, 3, 'bar()', 1, NULL, 'export')`,
    );
    db.run(
      `INSERT INTO calls (file_path, caller_name, caller_scope, callee_name, line_start, column_start, column_end)
       VALUES ('src/a.ts', 'foo', 'foo', 'bar', 3, 0, 0)`,
    );
  } finally {
    closeDb(db);
  }
}

describe("dedupeNames", () => {
  it("preserves order and drops duplicates", () => {
    expect(dedupeNames(["foo", "bar", "foo"])).toEqual(["foo", "bar"]);
  });
});

describe("composeTraceResult cross-file", () => {
  it("resolves callee snippets from another file", () => {
    seedCrossFileCallGraph();
    const path = executeCallPath({ root: benchDir, from: "foo", to: "bar" });
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    const composed = composeTraceResult({
      root: benchDir,
      from: "foo",
      to: "bar",
      path: path.rows,
    });
    expect(
      composed.snippets.some(
        (s) => s.name === "bar" && s.file_path === "src/b.ts",
      ),
    ).toBe(true);
  });

  it("sets truncated when snippet budget is tiny", () => {
    seedCallGraph();
    const path = executeCallPath({ root: benchDir, from: "foo", to: "bar" });
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    const composed = composeTraceResult({
      root: benchDir,
      from: "foo",
      to: "bar",
      path: path.rows,
      budgetChars: 1,
    });
    expect(composed.truncated).toBe(true);
    expect(composed.truncation?.snippets).toBe(true);
  });
});

describe("composeExploreResult dedupe", () => {
  it("dedupes duplicate seed names", () => {
    seedCallGraph();
    const r = composeExploreResult({ root: benchDir, names: ["foo", "foo"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.names).toEqual(["foo"]);
  });

  it("sets truncation.rows when rowLimit exceeded", () => {
    seedCallGraph();
    const r = composeExploreResult({
      root: benchDir,
      names: ["foo", "bar"],
      rowLimit: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.rows).toHaveLength(1);
    expect(r.result.truncated).toBe(true);
    expect(r.result.truncation?.rows).toBe(true);
  });
});
