import { describe, expect, it } from "bun:test";

import { assertReadOnlyIndexedSql } from "./benchmark-config";

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
