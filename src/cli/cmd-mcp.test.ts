import { describe, expect, it } from "bun:test";

import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { parseMcpRest } from "./cmd-mcp";

describe("parseMcpRest", () => {
  it("returns run with defaults (no flags)", () => {
    const r = parseMcpRest(["mcp"]);
    expect(r.kind).toBe("run");
    if (r.kind === "run") {
      // CODEMAP_WATCH env may be set in dev shells; ignore in this assertion.
      expect(r.debounceMs).toBe(DEFAULT_DEBOUNCE_MS);
    }
  });

  it("returns help on --help", () => {
    expect(parseMcpRest(["mcp", "--help"]).kind).toBe("help");
    expect(parseMcpRest(["mcp", "-h"]).kind).toBe("help");
  });

  it("parses --watch", () => {
    const r = parseMcpRest(["mcp", "--watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
  });

  it("parses --debounce <ms>", () => {
    const r = parseMcpRest(["mcp", "--debounce", "500"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.debounceMs).toBe(500);
  });

  it("composes --watch + --debounce", () => {
    const r = parseMcpRest(["mcp", "--watch", "--debounce", "100"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
    expect(r.debounceMs).toBe(100);
  });

  it("rejects --debounce with non-numeric value", () => {
    const r = parseMcpRest(["mcp", "--debounce", "abc"]);
    expect(r.kind).toBe("error");
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
