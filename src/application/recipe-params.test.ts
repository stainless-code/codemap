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
    expect(r).toEqual({ ok: true, values: ["function", 42, false] });
  });

  it("uses defaults for omitted optional params", () => {
    const r = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function" },
    });
    expect(r).toEqual({ ok: true, values: ["function", 80, true] });
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
    expect(truthy).toEqual({ ok: true, values: ["function", 80, true] });

    const falsy = resolveRecipeParams({
      recipeId: "example",
      declared,
      provided: { kind: "function", include_tests: 0 },
    });
    expect(falsy).toEqual({ ok: true, values: ["function", 80, false] });
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
