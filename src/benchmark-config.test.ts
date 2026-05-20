import { describe, expect, it } from "bun:test";

import {
  assertReadOnlyIndexedSql,
  collectGlobalRegexMatches,
} from "./benchmark-config";

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
