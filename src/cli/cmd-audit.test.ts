import { describe, expect, it } from "bun:test";

import { parseAuditRest } from "./cmd-audit";

describe("parseAuditRest", () => {
  it("errors when no flags given", () => {
    const r = parseAuditRest(["audit"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--baseline");
  });

  it("returns help on --help / -h", () => {
    expect(parseAuditRest(["audit", "--help"]).kind).toBe("help");
    expect(parseAuditRest(["audit", "-h"]).kind).toBe("help");
  });

  it("parses --baseline <name>", () => {
    const r = parseAuditRest(["audit", "--baseline", "pre-refactor"]);
    expect(r).toEqual({
      kind: "run",
      baselineName: "pre-refactor",
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --baseline=<name>", () => {
    const r = parseAuditRest(["audit", "--baseline=pre-refactor"]);
    expect(r).toEqual({
      kind: "run",
      baselineName: "pre-refactor",
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --json --summary --no-index --baseline pre-refactor (any order)", () => {
    const r = parseAuditRest([
      "audit",
      "--json",
      "--summary",
      "--no-index",
      "--baseline",
      "pre-refactor",
    ]);
    expect(r).toEqual({
      kind: "run",
      baselineName: "pre-refactor",
      json: true,
      summary: true,
      noIndex: true,
    });
  });

  it("errors when --baseline has no name following", () => {
    const r = parseAuditRest(["audit", "--baseline"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--baseline");
  });

  it("errors when --baseline= has empty name", () => {
    const r = parseAuditRest(["audit", "--baseline="]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("non-empty name");
  });

  it("errors when --baseline is followed by another flag", () => {
    const r = parseAuditRest(["audit", "--baseline", "--json"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--baseline");
  });

  it("errors on unknown options", () => {
    const r = parseAuditRest(["audit", "--unknown", "x", "--baseline", "n"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--unknown");
  });
});
