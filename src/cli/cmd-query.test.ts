import { describe, expect, it } from "bun:test";

import { parseQueryRest } from "./cmd-query";
import { getQueryRecipeSql } from "./query-recipes";

describe("parseQueryRest", () => {
  it("errors when only query", () => {
    const r = parseQueryRest(["query"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("missing SQL");
  });

  it("returns help for query --help", () => {
    expect(parseQueryRest(["query", "--help"]).kind).toBe("help");
    expect(parseQueryRest(["query", "-h"]).kind).toBe("help");
  });

  it("parses SQL after query", () => {
    const r = parseQueryRest(["query", "SELECT", "1"]);
    expect(r).toEqual({ kind: "run", sql: "SELECT 1", json: false });
  });

  it("parses --json and SQL", () => {
    const r = parseQueryRest(["query", "--json", "SELECT", "1"]);
    expect(r).toEqual({ kind: "run", sql: "SELECT 1", json: true });
  });

  it("errors when --json has no SQL", () => {
    const r = parseQueryRest(["query", "--json"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--json");
  });

  it("returns help for query --json --help", () => {
    expect(parseQueryRest(["query", "--json", "--help"]).kind).toBe("help");
  });

  it("parses --recipe fan-out-sample-json", () => {
    const r = parseQueryRest(["query", "--recipe", "fan-out-sample-json"]);
    const sql = getQueryRecipeSql("fan-out-sample-json");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: false,
    });
  });

  it("parses --recipe fan-out", () => {
    const r = parseQueryRest(["query", "--recipe", "fan-out"]);
    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: false,
    });
  });

  it("parses --json --recipe fan-out-sample", () => {
    const r = parseQueryRest(["query", "--json", "--recipe", "fan-out-sample"]);
    const sql = getQueryRecipeSql("fan-out-sample");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: true,
    });
  });

  it("parses --recipe fan-out --json", () => {
    const r = parseQueryRest(["query", "--recipe", "fan-out", "--json"]);
    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: true,
    });
  });

  it("errors on unknown recipe", () => {
    const r = parseQueryRest(["query", "--recipe", "nope"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("unknown recipe");
      expect(r.message).toContain("fan-out");
    }
  });

  it("errors when --recipe has no id", () => {
    const r = parseQueryRest(["query", "--recipe"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--recipe");
  });

  it("errors when extra tokens after recipe", () => {
    const r = parseQueryRest(["query", "--recipe", "fan-out", "SELECT", "1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("does not take");
  });
});
