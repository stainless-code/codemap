import { describe, expect, it } from "bun:test";

import type { SymbolMatch } from "../application/show-engine";
import { buildShowResult } from "../application/show-engine";
import { parseShowRest } from "./cmd-show";

describe("parseShowRest", () => {
  it("returns help on --help / -h", () => {
    expect(parseShowRest(["show", "--help"]).kind).toBe("help");
    expect(parseShowRest(["show", "-h"]).kind).toBe("help");
  });

  it("errors when no <name> given", () => {
    const r = parseShowRest(["show"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("missing <name>");
  });

  it("errors on extra positional argument (no fuzzy fallback)", () => {
    const r = parseShowRest(["show", "foo", "bar"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unexpected extra");
  });

  it("errors on unknown flag", () => {
    const r = parseShowRest(["show", "foo", "--regex"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--regex");
  });

  it("errors when --kind has no value", () => {
    const r = parseShowRest(["show", "foo", "--kind"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--kind");
  });

  it("errors when --in has no value", () => {
    const r = parseShowRest(["show", "foo", "--in"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--in");
  });

  it("parses bare name", () => {
    const r = parseShowRest(["show", "foo"]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: undefined,
      inPath: undefined,
      json: false,
    });
  });

  it("parses name + flags in any order", () => {
    const r = parseShowRest([
      "show",
      "--json",
      "--kind",
      "function",
      "foo",
      "--in",
      "src/cli",
    ]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: "function",
      inPath: "src/cli",
      json: true,
    });
  });

  it("throws if rest[0] is not 'show'", () => {
    expect(() => parseShowRest(["query"])).toThrow();
  });
});

describe("buildShowResult — disambiguation envelope (Q-2)", () => {
  function match(
    file: string,
    name: string,
    kind = "function",
    line = 1,
  ): SymbolMatch {
    return {
      name,
      kind,
      file_path: file,
      line_start: line,
      line_end: line,
      signature: `${kind} ${name}`,
      is_exported: 1,
      parent_name: null,
      visibility: null,
    };
  }

  it("single match → no disambiguation block", () => {
    const r = buildShowResult([match("src/a.ts", "foo")]);
    expect(r.matches).toHaveLength(1);
    expect(r.disambiguation).toBeUndefined();
  });

  it("zero matches → empty matches, no disambiguation", () => {
    const r = buildShowResult([]);
    expect(r).toEqual({ matches: [] });
  });

  it("multi-match adds disambiguation with n + by_kind + files + hint", () => {
    const r = buildShowResult([
      match("src/a.ts", "foo", "function"),
      match("src/b.ts", "foo", "function"),
      match("src/c.ts", "foo", "const"),
    ]);
    expect(r.matches).toHaveLength(3);
    expect(r.disambiguation).toEqual({
      n: 3,
      by_kind: { function: 2, const: 1 },
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      hint: "Multiple matches. Narrow with --kind <kind> or --in <path>.",
    });
  });

  it("dedupes files in disambiguation.files", () => {
    const r = buildShowResult([
      match("src/a.ts", "foo", "function", 5),
      match("src/a.ts", "foo", "function", 50),
    ]);
    expect(r.disambiguation?.files).toEqual(["src/a.ts"]);
  });
});
