import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { parseMcpRest } from "./cmd-mcp";

describe("parseMcpRest", () => {
  // CODEMAP_WATCH may be set in dev shells; clear it so default-ON
  // assertions below are deterministic.
  let savedWatchEnv: string | undefined;
  beforeEach(() => {
    savedWatchEnv = process.env["CODEMAP_WATCH"];
    delete process.env["CODEMAP_WATCH"];
  });
  afterEach(() => {
    if (savedWatchEnv === undefined) delete process.env["CODEMAP_WATCH"];
    else process.env["CODEMAP_WATCH"] = savedWatchEnv;
  });

  it("returns run with defaults — watch ON since 2026-05", () => {
    const r = parseMcpRest(["mcp"]);
    expect(r.kind).toBe("run");
    if (r.kind === "run") {
      expect(r.watch).toBe(true);
      expect(r.debounceMs).toBe(DEFAULT_DEBOUNCE_MS);
    }
  });

  it("returns help on --help", () => {
    expect(parseMcpRest(["mcp", "--help"]).kind).toBe("help");
    expect(parseMcpRest(["mcp", "-h"]).kind).toBe("help");
  });

  it("parses --watch (no-op after default-ON flip; backwards-compat)", () => {
    const r = parseMcpRest(["mcp", "--watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
  });

  it("parses --no-watch (explicit opt-out)", () => {
    const r = parseMcpRest(["mcp", "--no-watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it("CODEMAP_WATCH=0 opts out of default-ON watcher", () => {
    process.env["CODEMAP_WATCH"] = "0";
    const r = parseMcpRest(["mcp"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it('CODEMAP_WATCH="false" opts out of default-ON watcher', () => {
    process.env["CODEMAP_WATCH"] = "false";
    const r = parseMcpRest(["mcp"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it("--no-watch wins over --watch (last-write semantics)", () => {
    const r = parseMcpRest(["mcp", "--watch", "--no-watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
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
