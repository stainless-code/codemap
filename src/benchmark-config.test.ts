import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertReadOnlyIndexedSql,
  collectGlobalRegexMatches,
  loadScenariosFromConfigFile,
} from "./benchmark-config";
import { closeDb } from "./db";
import { openCodemapDatabase } from "./sqlite-db";

describe("assertReadOnlyIndexedSql", () => {
  it("allows SELECT", () => {
    expect(() => assertReadOnlyIndexedSql("SELECT 1")).not.toThrow();
  });

  it("allows WITH … SELECT", () => {
    expect(() =>
      assertReadOnlyIndexedSql("WITH t AS (SELECT 1 AS x) SELECT * FROM t"),
    ).not.toThrow();
  });

  it("rejects multiple statements", () => {
    expect(() => assertReadOnlyIndexedSql("SELECT 1; SELECT 2")).toThrow(
      /single statement/,
    );
  });

  it("rejects DELETE", () => {
    expect(() => assertReadOnlyIndexedSql("DELETE FROM files")).toThrow(
      /read-only/,
    );
  });

  it("rejects RETURNING", () => {
    expect(() => assertReadOnlyIndexedSql("SELECT 1 RETURNING 2")).toThrow(
      /RETURNING/,
    );
  });
});

describe("collectGlobalRegexMatches", () => {
  it("advances past zero-length matches instead of hanging", () => {
    const started = Date.now();
    const matches = collectGlobalRegexMatches("hello", "(a|)");
    expect(Date.now() - started).toBeLessThan(500);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(20);
  });

  it("collects normal matches", () => {
    expect(collectGlobalRegexMatches("import foo\n", "^import")).toEqual([
      "import",
    ]);
  });
});

describe("loadScenariosFromConfigFile", () => {
  it("rejects invalid traditional.regex at load time", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-bench-cfg-"));
    const path = join(dir, "scenarios.json");
    writeFileSync(
      path,
      JSON.stringify({
        scenarios: [
          {
            name: "bad-regex",
            indexedSql: "SELECT 1",
            traditional: {
              globs: ["**/*"],
              regex: "(unclosed",
              mode: "files",
            },
          },
        ],
      }),
    );
    const db = openCodemapDatabase(":memory:");
    try {
      expect(() => loadScenariosFromConfigFile(db, path)).toThrow(
        /valid regex/,
      );
    } finally {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
