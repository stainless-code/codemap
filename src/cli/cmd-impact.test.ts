import { describe, expect, it } from "bun:test";

import { parseImpactRest } from "./cmd-impact";

describe("parseImpactRest — happy paths", () => {
  it("requires the impact subcommand position", () => {
    expect(() => parseImpactRest(["query"])).toThrow();
  });

  it("returns help on --help / -h", () => {
    expect(parseImpactRest(["impact", "--help"])).toEqual({ kind: "help" });
    expect(parseImpactRest(["impact", "-h"])).toEqual({ kind: "help" });
  });

  it("parses a single target with all defaults", () => {
    const r = parseImpactRest(["impact", "handleQuery"]);
    expect(r).toEqual({
      kind: "run",
      target: "handleQuery",
      direction: "both",
      via: "all",
      depth: 3,
      limit: 500,
      summary: false,
      json: false,
    });
  });

  it("parses --direction / --via / --depth / --limit / --summary / --json", () => {
    const r = parseImpactRest([
      "impact",
      "src/db.ts",
      "--direction",
      "up",
      "--via",
      "dependencies",
      "--depth",
      "5",
      "--limit",
      "100",
      "--summary",
      "--json",
    ]);
    expect(r).toEqual({
      kind: "run",
      target: "src/db.ts",
      direction: "up",
      via: "dependencies",
      depth: 5,
      limit: 100,
      summary: true,
      json: true,
    });
  });

  it("accepts --depth 0 (unbounded sentinel)", () => {
    const r = parseImpactRest(["impact", "x", "--depth", "0"]);
    expect(r).toMatchObject({ kind: "run", depth: 0 });
  });
});

describe("parseImpactRest — validation", () => {
  it("rejects missing target", () => {
    const r = parseImpactRest(["impact"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/missing <target>/);
  });

  it("rejects extra positional args", () => {
    const r = parseImpactRest(["impact", "a", "b"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error")
      expect(r.message).toMatch(/unexpected extra argument/);
  });

  it("rejects unknown flags", () => {
    const r = parseImpactRest(["impact", "x", "--unknown"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown option/);
  });

  it("rejects unknown --direction", () => {
    const r = parseImpactRest(["impact", "x", "--direction", "sideways"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown --direction/);
  });

  it("rejects unknown --via", () => {
    const r = parseImpactRest(["impact", "x", "--via", "telepathy"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/unknown --via/);
  });

  it("rejects negative --depth", () => {
    const r = parseImpactRest(["impact", "x", "--depth", "-1"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/non-negative integer/);
  });

  it("rejects non-integer --depth", () => {
    const r = parseImpactRest(["impact", "x", "--depth", "1.5"]);
    expect(r.kind).toBe("error");
  });

  it("rejects zero/negative --limit", () => {
    const r1 = parseImpactRest(["impact", "x", "--limit", "0"]);
    expect(r1.kind).toBe("error");
    const r2 = parseImpactRest(["impact", "x", "--limit", "-5"]);
    expect(r2.kind).toBe("error");
  });

  it("rejects --direction without value", () => {
    const r = parseImpactRest(["impact", "x", "--direction"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/requires a value/);
  });
});
