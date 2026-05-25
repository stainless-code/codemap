import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  CHANGED_PATH_DELIM,
  executeAffectedTests,
  joinChangedPaths,
  normalizeChangedPathList,
  resolveAffectedChangedPaths,
} from "./affected-engine";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "affected-engine-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(join(benchDir, "package.json"), "{}\n");
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES
         ('src/lib/util.ts', 'h1', 10, 1, 'typescript', 1, 1),
         ('src/__tests__/util.test.ts', 'h2', 10, 1, 'typescript', 1, 1)`,
    );
    db.run(
      `INSERT INTO dependencies (from_path, to_path)
       VALUES ('src/__tests__/util.test.ts', 'src/lib/util.ts')`,
    );
    db.run(
      `INSERT INTO test_suites (file_path, name, kind, line_start, line_end, framework)
       VALUES ('src/__tests__/util.test.ts', 'util', 'describe', 1, 10, 'bun-test')`,
    );
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

describe("normalizeChangedPathList / joinChangedPaths", () => {
  it("joins unique trimmed paths with RS delimiter", () => {
    expect(
      joinChangedPaths([
        "src/a.ts",
        "./src/b.ts",
        "src/a.ts",
        "",
        "  src/c.ts  ",
      ]),
    ).toBe(["src/a.ts", "src/b.ts", "src/c.ts"].join(CHANGED_PATH_DELIM));
  });

  it("normalizeChangedPathList dedupes while preserving order", () => {
    expect(
      normalizeChangedPathList(["./src/a.ts", "src/a.ts", "src/b.ts"]),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("resolveAffectedChangedPaths", () => {
  it("returns explicit paths when provided", () => {
    expect(
      resolveAffectedChangedPaths({
        root: benchDir,
        paths: ["./src/foo.ts", "src/foo.ts"],
      }),
    ).toEqual({ ok: true, paths: ["src/foo.ts"] });
  });

  it("returns empty array for explicit empty paths", () => {
    expect(resolveAffectedChangedPaths({ root: benchDir, paths: [] })).toEqual({
      ok: true,
      paths: [],
    });
  });
});

describe("executeAffectedTests", () => {
  it("returns transitive test file for a changed source path", () => {
    const result = executeAffectedTests({
      root: benchDir,
      changedPaths: ["src/lib/util.ts"],
    });
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          test_path: "src/__tests__/util.test.ts",
          impact_depth: 1,
          actions: [
            {
              type: "run-affected-tests",
              description:
                "Test file paths only — CI composes the exit policy and runner command.",
            },
          ],
        },
      ],
    });
  });

  it("returns empty rows when no changed paths", () => {
    expect(executeAffectedTests({ root: benchDir, changedPaths: [] })).toEqual({
      ok: true,
      rows: [],
    });
  });
});
