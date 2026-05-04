import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { DEFAULT_HOST, DEFAULT_PORT, parseServeRest } from "./cmd-serve";

describe("parseServeRest", () => {
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

  it("returns run with defaults when no flags (watch: true since 2026-05)", () => {
    const r = parseServeRest(["serve"]);
    expect(r).toEqual({
      kind: "run",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      token: undefined,
      watch: true,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    });
  });

  it("returns help on --help / -h", () => {
    expect(parseServeRest(["serve", "--help"]).kind).toBe("help");
    expect(parseServeRest(["serve", "-h"]).kind).toBe("help");
  });

  it("parses --port <n>", () => {
    const r = parseServeRest(["serve", "--port", "9000"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.port).toBe(9000);
  });

  it("parses --port=<n> equals form", () => {
    const r = parseServeRest(["serve", "--port=9001"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.port).toBe(9001);
  });

  it("rejects --port with no value", () => {
    const r = parseServeRest(["serve", "--port"]);
    expect(r.kind).toBe("error");
  });

  it("rejects --port with non-numeric value", () => {
    const r = parseServeRest(["serve", "--port", "abc"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("not a valid port");
  });

  it("rejects --port out of range", () => {
    const r0 = parseServeRest(["serve", "--port", "0"]);
    expect(r0.kind).toBe("error");
    const rOver = parseServeRest(["serve", "--port", "65536"]);
    expect(rOver.kind).toBe("error");
  });

  it("parses --host <ip>", () => {
    const r = parseServeRest(["serve", "--host", "0.0.0.0"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.host).toBe("0.0.0.0");
  });

  it("parses --token <secret>", () => {
    const r = parseServeRest(["serve", "--token", "abc123"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.token).toBe("abc123");
  });

  it("parses --token=<secret> equals form", () => {
    const r = parseServeRest(["serve", "--token=xyz"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.token).toBe("xyz");
  });

  it("rejects --token with no value", () => {
    const r = parseServeRest(["serve", "--token"]);
    expect(r.kind).toBe("error");
  });

  it("rejects unknown flag", () => {
    const r = parseServeRest(["serve", "--bogus"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--bogus");
  });

  it("composes host + port + token", () => {
    const r = parseServeRest([
      "serve",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
      "--token",
      "secret",
    ]);
    expect(r).toEqual({
      kind: "run",
      host: "0.0.0.0",
      port: 9000,
      token: "secret",
      watch: true,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    });
  });

  it("throws if rest[0] is not 'serve'", () => {
    expect(() => parseServeRest(["query"])).toThrow();
  });

  it("parses --watch (no-op after default-ON flip; backwards-compat)", () => {
    const r = parseServeRest(["serve", "--watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
  });

  it("parses --no-watch (explicit opt-out)", () => {
    const r = parseServeRest(["serve", "--no-watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it("CODEMAP_WATCH=0 opts out of default-ON watcher", () => {
    process.env["CODEMAP_WATCH"] = "0";
    const r = parseServeRest(["serve"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it('CODEMAP_WATCH="false" opts out of default-ON watcher', () => {
    process.env["CODEMAP_WATCH"] = "false";
    const r = parseServeRest(["serve"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it("CODEMAP_WATCH=1 still honored (redundant after flip but back-compat)", () => {
    process.env["CODEMAP_WATCH"] = "1";
    const r = parseServeRest(["serve"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
  });

  it("--no-watch wins over --watch (last-write semantics)", () => {
    const r = parseServeRest(["serve", "--watch", "--no-watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(false);
  });

  it("parses --debounce <ms>", () => {
    const r = parseServeRest(["serve", "--debounce", "500"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.debounceMs).toBe(500);
  });

  it("composes --watch + --debounce + --port", () => {
    const r = parseServeRest([
      "serve",
      "--watch",
      "--debounce",
      "100",
      "--port",
      "9000",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
    expect(r.debounceMs).toBe(100);
    expect(r.port).toBe(9000);
  });

  it("rejects --debounce with non-numeric value", () => {
    const r = parseServeRest(["serve", "--debounce", "abc"]);
    expect(r.kind).toBe("error");
  });
});
