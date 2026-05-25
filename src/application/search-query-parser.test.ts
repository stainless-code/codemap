import { describe, expect, it } from "bun:test";

import { parseSearchQuery, tokenizeSearchQuery } from "./search-query-parser";

describe("parseSearchQuery", () => {
  it("parses kind + name + path fields", () => {
    const r = parseSearchQuery("kind:function name:Auth path:src/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed).toEqual({
      kind: "function",
      namePatterns: ["Auth"],
      freeText: [],
      path: "src/",
    });
  });

  it("parses quoted name values with spaces", () => {
    const r = parseSearchQuery('name:"use Query" kind:function');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.namePatterns).toEqual(["use Query"]);
  });

  it("treats unqualified tokens as free text", () => {
    const r = parseSearchQuery("Auth kind:function");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.freeText).toEqual(["Auth"]);
    expect(r.parsed.kind).toBe("function");
  });

  it("parses in: glob field", () => {
    const r = parseSearchQuery("in:src/**/*.ts name:foo");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.inGlob).toBe("src/**/*.ts");
    expect(r.parsed.namePatterns).toEqual(["foo"]);
  });

  it("rejects unknown fields", () => {
    const r = parseSearchQuery("file:src/foo.ts");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown search field");
  });

  it("rejects empty query", () => {
    expect(parseSearchQuery("   ").ok).toBe(false);
  });

  it("rejects duplicate kind", () => {
    const r = parseSearchQuery("kind:function kind:const");
    expect(r.ok).toBe(false);
  });
});

describe("tokenizeSearchQuery", () => {
  it("preserves quoted segments with spaces", () => {
    expect(tokenizeSearchQuery('name:"use Query"')).toEqual([
      'name:"use Query"',
    ]);
  });
});
