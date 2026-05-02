import { describe, expect, it } from "bun:test";

import {
  getQueryRecipeActions,
  getQueryRecipeSql,
  listQueryRecipeCatalog,
} from "../application/query-recipes";
import { parseQueryRest } from "./cmd-query";

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
      format: "text",
      summary: false,
      changedSince: undefined,
      recipeId: undefined,
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --json and SQL", () => {
    const r = parseQueryRest(["query", "--json", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: true,
      format: "json",
      summary: false,
      changedSince: undefined,
      recipeId: undefined,
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --summary and SQL", () => {
    const r = parseQueryRest(["query", "--summary", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: false,
      format: "text",
      summary: true,
      changedSince: undefined,
      recipeId: undefined,
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --json --summary and SQL", () => {
    const r = parseQueryRest(["query", "--json", "--summary", "SELECT", "1"]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: true,
      format: "json",
      summary: true,
      changedSince: undefined,
      recipeId: undefined,
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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
      format: "text",
      summary: true,
      changedSince: undefined,
      recipeId: "fan-out",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --changed-since <ref> with SQL", () => {
    const r = parseQueryRest([
      "query",
      "--changed-since",
      "origin/main",
      "SELECT 1",
    ]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT 1",
      json: false,
      format: "text",
      summary: false,
      changedSince: "origin/main",
      recipeId: undefined,
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --json --changed-since HEAD~3 -r fan-out", () => {
    const r = parseQueryRest([
      "query",
      "--json",
      "--changed-since",
      "HEAD~3",
      "-r",
      "fan-out",
    ]);
    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: true,
      format: "json",
      summary: false,
      changedSince: "HEAD~3",
      recipeId: "fan-out",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --group-by directory with SQL", () => {
    const r = parseQueryRest([
      "query",
      "--json",
      "--group-by",
      "directory",
      "SELECT * FROM symbols",
    ]);
    expect(r).toEqual({
      kind: "run",
      sql: "SELECT * FROM symbols",
      json: true,
      format: "json",
      summary: false,
      changedSince: undefined,
      recipeId: undefined,
      groupBy: "directory",
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("parses --group-by owner --recipe fan-in", () => {
    const r = parseQueryRest(["query", "--group-by", "owner", "-r", "fan-in"]);
    const sql = getQueryRecipeSql("fan-in");
    expect(sql).toBeDefined();
    expect(r).toEqual({
      kind: "run",
      sql: sql!,
      json: false,
      format: "text",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-in",
      groupBy: "owner",
      saveBaseline: undefined,
      baseline: undefined,
    });
  });

  it("errors when --group-by has no mode", () => {
    const r = parseQueryRest(["query", "--group-by"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--group-by");
  });

  it("errors on unknown --group-by mode", () => {
    const r = parseQueryRest(["query", "--group-by", "branch", "SELECT 1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unknown --group-by");
  });

  // ---------- baseline flags ----------

  it("parses bare --save-baseline + --recipe (default name = recipe id)", () => {
    const r = parseQueryRest(["query", "--save-baseline", "-r", "fan-out"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.recipeId).toBe("fan-out");
    expect(r.saveBaseline).toBe(true);
    expect(r.baseline).toBeUndefined();
  });

  it("parses --save-baseline=<name> with ad-hoc SQL", () => {
    const r = parseQueryRest([
      "query",
      "--save-baseline=pre-refactor",
      "SELECT 1",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.saveBaseline).toBe("pre-refactor");
  });

  it("errors when bare --save-baseline meets ad-hoc SQL with no following name", () => {
    const r = parseQueryRest(["query", "--save-baseline"]);
    expect(r.kind).toBe("error");
  });

  it("errors when --save-baseline= has empty name", () => {
    const r = parseQueryRest(["query", "--save-baseline=", "SELECT 1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("non-empty name");
  });

  it("parses --baseline=<name> with ad-hoc SQL", () => {
    const r = parseQueryRest(["query", "--baseline=pre-refactor", "SELECT 1"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.baseline).toBe("pre-refactor");
  });

  it("parses bare --baseline + --recipe", () => {
    const r = parseQueryRest(["query", "--baseline", "-r", "fan-out"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.baseline).toBe(true);
    expect(r.recipeId).toBe("fan-out");
  });

  it("errors when --save-baseline and --baseline are combined", () => {
    const r = parseQueryRest([
      "query",
      "--save-baseline",
      "--baseline",
      "-r",
      "fan-out",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("mutually exclusive");
  });

  it("parses --baselines as a list operation", () => {
    expect(parseQueryRest(["query", "--baselines"])).toEqual({
      kind: "listBaselines",
      json: false,
    });
    expect(parseQueryRest(["query", "--json", "--baselines"])).toEqual({
      kind: "listBaselines",
      json: true,
    });
  });

  it("rejects --baselines combined with SQL or other flags", () => {
    expect(parseQueryRest(["query", "--baselines", "SELECT 1"]).kind).toBe(
      "error",
    );
    expect(parseQueryRest(["query", "--baselines", "-r", "fan-out"]).kind).toBe(
      "error",
    );
  });

  it("parses --drop-baseline <name>", () => {
    expect(
      parseQueryRest(["query", "--drop-baseline", "pre-refactor"]),
    ).toEqual({
      kind: "dropBaseline",
      name: "pre-refactor",
      json: false,
    });
  });

  it("errors when --drop-baseline has no name", () => {
    const r = parseQueryRest(["query", "--drop-baseline"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--drop-baseline");
  });

  it("errors when --group-by is combined with --save-baseline or --baseline", () => {
    const r1 = parseQueryRest([
      "query",
      "--group-by",
      "directory",
      "--save-baseline",
      "-r",
      "fan-out",
    ]);
    expect(r1.kind).toBe("error");
    if (r1.kind === "error") expect(r1.message).toContain("--group-by");

    const r2 = parseQueryRest([
      "query",
      "--group-by",
      "directory",
      "--baseline",
      "-r",
      "fan-out",
    ]);
    expect(r2.kind).toBe("error");
    if (r2.kind === "error") expect(r2.message).toContain("--group-by");
  });

  it("errors when --baselines is combined with no-op flags", () => {
    expect(parseQueryRest(["query", "--summary", "--baselines"]).kind).toBe(
      "error",
    );
    expect(
      parseQueryRest(["query", "--changed-since", "main", "--baselines"]).kind,
    ).toBe("error");
    expect(
      parseQueryRest(["query", "--group-by", "directory", "--baselines"]).kind,
    ).toBe("error");
  });

  it("errors when --drop-baseline is combined with no-op flags", () => {
    expect(
      parseQueryRest(["query", "--summary", "--drop-baseline", "x"]).kind,
    ).toBe("error");
    expect(
      parseQueryRest([
        "query",
        "--group-by",
        "directory",
        "--drop-baseline",
        "x",
      ]).kind,
    ).toBe("error");
  });
});

describe("parseQueryRest (continued — these were mis-nested in a prior PR)", () => {
  it("errors when --changed-since has no ref", () => {
    const r = parseQueryRest(["query", "--changed-since"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--changed-since");
  });

  it("errors when --changed-since ref looks like another flag", () => {
    const r = parseQueryRest([
      "query",
      "--changed-since",
      "--json",
      "SELECT 1",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--changed-since");
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
      format: "text",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-out-sample-json",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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
      format: "text",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-out",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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
      format: "json",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-out-sample",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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
      format: "json",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-out",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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
      format: "json",
      summary: false,
      changedSince: undefined,
      recipeId: "fan-out",
      groupBy: undefined,
      saveBaseline: undefined,
      baseline: undefined,
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

describe("parseQueryRest — --format flag", () => {
  it("defaults to text when neither --json nor --format is passed", () => {
    const r = parseQueryRest(["query", "SELECT 1"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("text");
    expect(r.json).toBe(false);
  });

  it("--json implies format=json", () => {
    const r = parseQueryRest(["query", "--json", "SELECT 1"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("json");
  });

  it("accepts --format text|json|sarif|annotations", () => {
    for (const fmt of ["text", "json", "sarif", "annotations"] as const) {
      const r = parseQueryRest(["query", "--format", fmt, "SELECT 1"]);
      if (r.kind !== "run") throw new Error(`expected run for ${fmt}`);
      expect(r.format).toBe(fmt);
    }
  });

  it("accepts --format=<value> equals form", () => {
    const r = parseQueryRest(["query", "--format=sarif", "SELECT 1"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("sarif");
  });

  it("--format overrides --json (precedence per plan § D9)", () => {
    const r = parseQueryRest([
      "query",
      "--json",
      "--format",
      "sarif",
      "SELECT 1",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("sarif");
    expect(r.json).toBe(true); // unchanged — flag still set, just overridden
  });

  it("--format text wins over --json (resolved format honored at render time)", () => {
    const r = parseQueryRest([
      "query",
      "--json",
      "--format",
      "text",
      "SELECT 1",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("text");
    // Renderer reads `format`, not `json` (post-PR #43 fix per CodeRabbit).
  });

  it("--format json wins over no flag (renderer uses JSON path)", () => {
    const r = parseQueryRest(["query", "--format", "json", "SELECT 1"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.format).toBe("json");
    expect(r.json).toBe(false);
  });

  it("rejects --format with no value", () => {
    const r = parseQueryRest(["query", "--format"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--format");
  });

  it("rejects unknown --format value", () => {
    const r = parseQueryRest(["query", "--format", "xml", "SELECT 1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("xml");
      expect(r.message).toContain("sarif");
    }
  });

  it("rejects --format=", () => {
    const r = parseQueryRest(["query", "--format=", "SELECT 1"]);
    expect(r.kind).toBe("error");
  });

  // Combo-guard regression suite — locks the parse-time rejection of
  // `--format sarif|annotations` with flags that change the output shape
  // (different shapes — sarif/annotations only support flat row lists).
  // Mirrors the formatToolIncompatibility check on the MCP side.
  describe("combo guards (--format sarif|annotations + summary/group-by/baseline)", () => {
    it("rejects --format sarif + --summary on ad-hoc SQL", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "sarif",
        "--summary",
        "SELECT 1",
      ]);
      expect(r.kind).toBe("error");
      if (r.kind === "error") {
        expect(r.message).toContain("sarif");
        expect(r.message).toContain("--summary");
      }
    });

    it("rejects --format annotations + --group-by on a recipe", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "annotations",
        "--group-by",
        "directory",
        "-r",
        "fan-in",
      ]);
      expect(r.kind).toBe("error");
      if (r.kind === "error") {
        expect(r.message).toContain("annotations");
        expect(r.message).toContain("--group-by");
      }
    });

    it("rejects --format sarif + --baseline=<name> on ad-hoc SQL", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "sarif",
        "--baseline=base",
        "SELECT 1",
      ]);
      expect(r.kind).toBe("error");
      if (r.kind === "error") {
        expect(r.message).toContain("sarif");
        expect(r.message).toContain("--baseline");
      }
    });

    it("rejects --format annotations + --save-baseline=<name> on ad-hoc SQL", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "annotations",
        "--save-baseline=base",
        "SELECT 1",
      ]);
      expect(r.kind).toBe("error");
      if (r.kind === "error") {
        expect(r.message).toContain("annotations");
        expect(r.message).toContain("--save-baseline");
      }
    });

    it("rejects --format sarif + --baseline on a recipe (default-name form)", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "sarif",
        "--baseline",
        "-r",
        "deprecated-symbols",
      ]);
      expect(r.kind).toBe("error");
      if (r.kind === "error") expect(r.message).toContain("sarif");
    });

    it("--format text composes freely with --summary (text/json don't trigger the guard)", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "text",
        "--summary",
        "SELECT 1",
      ]);
      expect(r.kind).toBe("run");
    });

    it("--format json composes freely with --group-by", () => {
      const r = parseQueryRest([
        "query",
        "--format",
        "json",
        "--group-by",
        "directory",
        "SELECT file_path FROM symbols",
      ]);
      expect(r.kind).toBe("run");
    });
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

  it("includes actions templates on recipes that define them", () => {
    const cat = listQueryRecipeCatalog();
    const fanOut = cat.find((r) => r.id === "fan-out");
    expect(fanOut?.actions).toBeDefined();
    expect(fanOut?.actions?.[0]).toMatchObject({ type: "review-coupling" });

    const deprecated = cat.find((r) => r.id === "deprecated-symbols");
    expect(deprecated?.actions?.[0]).toMatchObject({ type: "flag-caller" });
  });

  it("omits actions when the recipe doesn't define them", () => {
    const cat = listQueryRecipeCatalog();
    const indexSummary = cat.find((r) => r.id === "index-summary");
    expect(indexSummary).toBeDefined();
    expect(indexSummary?.actions).toBeUndefined();
  });
});

describe("getQueryRecipeActions", () => {
  it("returns the action template for a recipe with actions", () => {
    const actions = getQueryRecipeActions("barrel-files");
    expect(actions).toBeDefined();
    expect(actions?.[0]?.type).toBe("split-barrel");
    expect(actions?.[0]?.description).toMatch(/barrel/i);
  });

  it("returns undefined for recipes without actions", () => {
    expect(getQueryRecipeActions("index-summary")).toBeUndefined();
    expect(getQueryRecipeActions("markers-by-kind")).toBeUndefined();
  });

  it("returns undefined for unknown recipes", () => {
    expect(getQueryRecipeActions("nope-not-real")).toBeUndefined();
  });
});
