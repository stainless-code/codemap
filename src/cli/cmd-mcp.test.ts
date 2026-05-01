import { describe, expect, it } from "bun:test";

import { parseMcpRest } from "./cmd-mcp";

describe("parseMcpRest", () => {
  it("returns run with no extra args", () => {
    const r = parseMcpRest(["mcp"]);
    expect(r.kind).toBe("run");
  });

  it("returns help on --help", () => {
    expect(parseMcpRest(["mcp", "--help"]).kind).toBe("help");
    expect(parseMcpRest(["mcp", "-h"]).kind).toBe("help");
  });

  it("errors on unknown flag", () => {
    const r = parseMcpRest(["mcp", "--port", "3000"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--port");
  });

  it("throws if rest[0] is not 'mcp'", () => {
    expect(() => parseMcpRest(["query"])).toThrow();
  });
});
