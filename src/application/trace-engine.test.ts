import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installCodemapTestTeardown } from "../test-helpers/runtime-reset";

installCodemapTestTeardown();

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, insertFile, openDb } from "../db";
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

  it("applies adaptive explore row limit when rowLimit omitted on large index", () => {
    seedWideCallGraph(130);
    const db = openDb();
    try {
      seedBulkFiles(db, 5000);
    } finally {
      closeDb(db);
    }
    const r = composeExploreResult({ root: benchDir, names: ["hub"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.rows.length).toBeLessThanOrEqual(125);
    expect(r.result.truncation?.rows).toBe(true);
  });

  it("applies mid-tier explore row limit when rowLimit omitted", () => {
    seedWideCallGraph(260);
    const db = openDb();
    try {
      seedBulkFiles(db, 500);
    } finally {
      closeDb(db);
    }
    const r = composeExploreResult({ root: benchDir, names: ["hub"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.rows.length).toBeLessThanOrEqual(250);
    expect(r.result.truncation?.rows).toBe(true);
  });

  it("keeps adaptive explore row limit when budget_chars is explicit", () => {
    seedWideCallGraph(130);
    const db = openDb();
    try {
      seedBulkFiles(db, 5000);
    } finally {
      closeDb(db);
    }
    const r = composeExploreResult({
      root: benchDir,
      names: ["hub"],
      budgetChars: 15_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.rows.length).toBeLessThanOrEqual(125);
    expect(r.result.truncation?.rows).toBe(true);
    expect(r.result.truncation?.snippets).toBeUndefined();
  });
});

function seedBulkFiles(db: ReturnType<typeof openDb>, count: number): void {
  for (let i = 0; i < count; i++) {
    insertFile(db, {
      path: `src/bulk/${i}.ts`,
      content_hash: `hb${i}`,
      size: 1,
      line_count: 1,
      language: "typescript",
      last_modified: 1,
      indexed_at: 1,
    });
  }
}

function seedWideCallGraph(calleeCount: number): void {
  const bodyLines = [`export function hub() {`];
  for (let i = 0; i < calleeCount; i++) {
    bodyLines.push(`  fn${i}();`);
  }
  bodyLines.push("}");
  for (let i = 0; i < calleeCount; i++) {
    bodyLines.push(`export function fn${i}() { return ${i}; }`);
  }
  writeFileSync(join(benchDir, "src", "wide.ts"), `${bodyLines.join("\n")}\n`);

  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/wide.ts', 'hw', 500, ${calleeCount + 3}, 'typescript', 1, 1)`,
    );
    const symbolValues: string[] = [
      "('hub', 'function', 'src/wide.ts', 1, 2, 'hub()', 1, NULL, 'export')",
    ];
    for (let i = 0; i < calleeCount; i++) {
      const line = 3 + i;
      symbolValues.push(
        `('fn${i}', 'function', 'src/wide.ts', ${line}, ${line}, 'fn${i}()', 1, NULL, 'export')`,
      );
    }
    db.run(
      `INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, is_exported, parent_name, visibility)
       VALUES ${symbolValues.join(",")}`,
    );
    const callValues: string[] = [];
    for (let i = 0; i < calleeCount; i++) {
      callValues.push(`('src/wide.ts', 'hub', 'hub', 'fn${i}', 2, 0, 0)`);
    }
    db.run(
      `INSERT INTO calls (file_path, caller_name, caller_scope, callee_name, line_start, column_start, column_end)
       VALUES ${callValues.join(",")}`,
    );
  } finally {
    closeDb(db);
  }
}

describe("adaptive output budgets", () => {
  it("composeTraceResult uses adaptive snippet budget when budgetChars omitted", () => {
    seedLongSnippetCallGraph();
    const db = openDb();
    try {
      seedBulkFiles(db, 5999);
    } finally {
      closeDb(db);
    }
    const path = executeCallPath({ root: benchDir, from: "foo", to: "bar" });
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    const adaptive = composeTraceResult({
      root: benchDir,
      from: "foo",
      to: "bar",
      path: path.rows,
    });
    const explicit = composeTraceResult({
      root: benchDir,
      from: "foo",
      to: "bar",
      path: path.rows,
      budgetChars: 15_000,
    });
    expect(adaptive.truncated).toBe(true);
    expect(explicit.truncated).toBe(false);
  });

  it("composeNodeResult uses adaptive snippet budget when budgetChars omitted", () => {
    seedLongSnippetCallGraph();
    const db = openDb();
    try {
      seedBulkFiles(db, 5999);
    } finally {
      closeDb(db);
    }
    const adaptive = composeNodeResult({
      root: benchDir,
      name: "foo",
      includeSnippets: true,
    });
    const explicit = composeNodeResult({
      root: benchDir,
      name: "foo",
      includeSnippets: true,
      budgetChars: 15_000,
    });
    expect(adaptive.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (!adaptive.ok || !explicit.ok) return;
    expect(adaptive.result.truncated).toBe(true);
    expect(explicit.result.truncated).toBe(false);
  });

  it("composeExploreResult uses adaptive snippet budget when budgetChars omitted", () => {
    seedLongSnippetCallGraph();
    const db = openDb();
    try {
      seedBulkFiles(db, 5999);
    } finally {
      closeDb(db);
    }
    const adaptive = composeExploreResult({
      root: benchDir,
      names: ["foo", "bar"],
    });
    const explicit = composeExploreResult({
      root: benchDir,
      names: ["foo", "bar"],
      budgetChars: 15_000,
    });
    expect(adaptive.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (!adaptive.ok || !explicit.ok) return;
    expect(adaptive.result.truncation?.snippets).toBe(true);
    expect(explicit.result.truncation?.snippets).toBeUndefined();
  });
});

function seedLongSnippetCallGraph(): void {
  const pad = (label: string) => `  // ${label}${"x".repeat(4000)}\n`;
  writeFileSync(
    join(benchDir, "src", "a.ts"),
    `export function foo() {\n${pad("foo")}  return bar();\n}\nexport function bar() {\n${pad("bar")}  return 1;\n}\n`,
  );
  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/a.ts', 'h1', 9000, 6, 'typescript', 1, 1)`,
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
