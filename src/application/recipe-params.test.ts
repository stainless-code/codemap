import { describe, expect, it } from "bun:test";

import {
  mergeParams,
  parseParamsCli,
  resolveRecipeParams,
} from "./recipe-params";
import type { RecipeParam } from "./recipes-loader";

const declared: RecipeParam[] = [
  { name: "kind", type: "string", required: true },
  { name: "min_coverage", type: "number", default: 80 },
  { name: "include_tests", type: "boolean", default: true },
];

describe("parseParamsCli", () => {
  it("parses comma-separated key=value pairs", () => {
    expect(parseParamsCli("kind=function,name_pattern=%Query%")).toEqual({
      kind: "function",
      name_pattern: "%Query%",
    });
  });

  it("splits on first equals so values may contain equals", () => {
    expect(parseParamsCli("query=a=b")).toEqual({ query: "a=b" });
  });

  it("treats empty values as explicit empty string", () => {
    expect(parseParamsCli("nullable=")).toEqual({ nullable: "" });
  });

  it("mergeParams uses last-write semantics", () => {
    expect(mergeParams({ kind: "const" }, { kind: "function" })).toEqual({
      kind: "function",
    });
  });
});

describe("resolveRecipeParams", () => {
  it("coerces declared string / number / boolean params in declaration order", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: {
        kind: "function",
        min_coverage: "42",
        include_tests: "false",
      },
    });
    expect(r).toEqual({ ok: true, values: ["function", 42, 0] });
  });

  it("uses defaults for omitted optional params", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function" },
    });
    expect(r).toEqual({ ok: true, values: ["function", 80, 1] });
  });

  it("never puts JS booleans in bind values", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: {
        kind: "function",
        include_tests: false,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const v of r.values) {
      expect(typeof v === "boolean").toBe(false);
      expect(
        typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "bigint" ||
          v === null,
      ).toBe(true);
    }
    expect(r.values).toEqual(["function", 80, 0]);
  });

  it("binds omitted optional params without defaults as null", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared: [
        { name: "required", type: "string", required: true },
        { name: "optional", type: "string" },
      ],
      provided: { required: "x" },
    });
    expect(r).toEqual({ ok: true, values: ["x", null] });
  });

  it("rejects explicit null from callers (omit key instead)", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared: [{ name: "min_coverage", type: "number", required: true }],
      // Cast: production maps are typed without null; runtime JSON can still send it.
      provided: { min_coverage: null as unknown as number },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("must not be null");
  });

  it("rejects missing required params", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: {},
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('missing required param "kind"');
  });

  it("rejects unknown params", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", typo: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown param "typo"');
  });

  it("accepts numeric 1/0 for boolean params (MCP/HTTP path)", () => {
    const truthy = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", include_tests: 1 },
    });
    expect(truthy).toEqual({ ok: true, values: ["function", 80, 1] });

    const falsy = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", include_tests: 0 },
    });
    expect(falsy).toEqual({ ok: true, values: ["function", 80, 0] });
  });

  it("rejects malformed numbers and booleans", () => {
    const badNumber = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", min_coverage: "eighty" },
    });
    expect(badNumber.ok).toBe(false);

    const badBoolean = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", include_tests: "maybe" },
    });
    expect(badBoolean.ok).toBe(false);
  });

  it("rejects non-integer number params", () => {
    const r = resolveRecipeParams({
      recipeId: "affected-tests",
      declared: [{ name: "max_depth", type: "number", required: false }],
      provided: { max_depth: 1.5 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/integer/);
  });

  it("rejects params passed to a recipe that declares none", () => {
    const r = resolveRecipeParams({
      recipeId: "plain",
      declared: undefined,
      provided: { kind: "function" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("declares no params");
  });
});
