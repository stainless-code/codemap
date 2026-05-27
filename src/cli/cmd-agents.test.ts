import { describe, expect, it } from "bun:test";

import { parseAgentsInitRest } from "./cmd-agents";

describe("parseAgentsInitRest", () => {
  it("parses flags and targets", () => {
    const r = parseAgentsInitRest([
      "--force",
      "--targets",
      "cursor,copilot",
      "--mcp",
    ]);
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.force).toBe(true);
    expect(r.targets).toEqual(["cursor", "copilot"]);
    expect(r.mcp).toBe(true);
  });

  it("rejects --targets with empty value", () => {
    const r = parseAgentsInitRest(["--targets"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("--targets requires a value");
    }
  });

  it("rejects --targets= with empty string", () => {
    const r = parseAgentsInitRest(["--targets="]);
    expect(r.kind).toBe("error");
  });
});
