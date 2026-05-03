import { describe, expect, it } from "bun:test";

import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { parseWatchRest } from "./cmd-watch";

describe("parseWatchRest", () => {
  it("returns run with defaults when no flags", () => {
    const r = parseWatchRest(["watch"]);
    expect(r).toEqual({
      kind: "run",
      debounceMs: DEFAULT_DEBOUNCE_MS,
      quiet: false,
    });
  });

  it("returns help on --help / -h", () => {
    expect(parseWatchRest(["watch", "--help"]).kind).toBe("help");
    expect(parseWatchRest(["watch", "-h"]).kind).toBe("help");
  });

  it("parses --debounce <ms>", () => {
    const r = parseWatchRest(["watch", "--debounce", "500"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.debounceMs).toBe(500);
  });

  it("parses --debounce=<ms> equals form", () => {
    const r = parseWatchRest(["watch", "--debounce=1000"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.debounceMs).toBe(1000);
  });

  it("accepts --debounce=0 (instant flush — useful for tests)", () => {
    const r = parseWatchRest(["watch", "--debounce", "0"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.debounceMs).toBe(0);
  });

  it("rejects --debounce with no value", () => {
    expect(parseWatchRest(["watch", "--debounce"]).kind).toBe("error");
  });

  it("rejects --debounce with non-numeric value", () => {
    const r = parseWatchRest(["watch", "--debounce", "abc"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("non-negative integer");
  });

  it("rejects negative --debounce", () => {
    const r = parseWatchRest(["watch", "--debounce", "-5"]);
    expect(r.kind).toBe("error");
  });

  it("parses --quiet", () => {
    const r = parseWatchRest(["watch", "--quiet"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.quiet).toBe(true);
  });

  it("composes --debounce + --quiet", () => {
    const r = parseWatchRest(["watch", "--quiet", "--debounce", "100"]);
    expect(r).toEqual({ kind: "run", debounceMs: 100, quiet: true });
  });

  it("rejects unknown flag", () => {
    const r = parseWatchRest(["watch", "--bogus"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--bogus");
  });

  it("throws if rest[0] is not 'watch'", () => {
    expect(() => parseWatchRest(["query"])).toThrow();
  });
});
