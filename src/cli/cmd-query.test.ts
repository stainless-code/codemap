import { describe, expect, it } from "bun:test";

import { parseQueryRest } from "./cmd-query";
import { getQueryRecipeSql, listQueryRecipeCatalog } from "./query-recipes";

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
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: false,
      summary: false,
    });
  });

  it("parses --json and SQL", () => {
    const r = parseQueryRest(["query", "--json", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: true,
      summary: false,
    });
  });

  it("parses --summary and SQL", () => {
    const r = parseQueryRest(["query", "--summary", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: false,
      summary: true,
    });
  });

  it("parses --json --summary and SQL", () => {
    const r = parseQueryRest(["query", "--json", "--summary", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: true,
      summary: true,
    });
  });

  it("parses --summary --recipe fan-out", () => {
    const r = parseQueryRest(["query", "--summary", "-r", "fan-out"]);
    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: false,
      summary: true,
    });
  });

  it("errors when --json has no SQL", () => {
    const r = parseQueryRest(["query", "--json"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("missing SQL or recipe");
    }
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
      summary: false,
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
      summary: false,
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
      summary: false,
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
      summary: false,
    });
  });

  it("accepts -r as a short alias for --recipe", () => {
    const r = parseQueryRest(["query", "--json", "-r", "fan-out"]);
    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: true,
      summary: false,
    });
  });

  it("errors when -r has no id", () => {
    const r = parseQueryRest(["query", "-r"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("-r");
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

  it("parses --recipes-json", () => {
    expect(parseQueryRest(["query", "--recipes-json"])).toEqual({
      kind: "recipesCatalog",
    });
  });

  it("parses --json --recipes-json", () => {
    expect(parseQueryRest(["query", "--json", "--recipes-json"])).toEqual({
      kind: "recipesCatalog",
    });
  });

  it("errors when --recipes-json has extra args", () => {
    const r = parseQueryRest(["query", "--recipes-json", "SELECT", "1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--recipes-json");
  });

  it("errors when --recipes-json combines with --recipe", () => {
    const r = parseQueryRest([
      "query",
      "--recipes-json",
      "--recipe",
      "fan-out",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--recipe");
  });

  it("parses --print-sql fan-out", () => {
    expect(parseQueryRest(["query", "--print-sql", "fan-out"])).toEqual({
      kind: "printRecipeSql",
      id: "fan-out",
    });
  });

  it("errors when --print-sql has unknown id", () => {
    const r = parseQueryRest(["query", "--print-sql", "nope"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unknown recipe");
  });

  it("errors when --print-sql has no id", () => {
    const r = parseQueryRest(["query", "--print-sql"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--print-sql");
  });
});

describe("listQueryRecipeCatalog", () => {
  it("matches QUERY_RECIPES ids and sql", () => {
    const cat = listQueryRecipeCatalog();
    expect(cat.length).toBeGreaterThan(0);
    for (const row of cat) {
      expect(getQueryRecipeSql(row.id)).toBe(row.sql);
      expect(row.description.length).toBeGreaterThan(0);
    }
  });
});
