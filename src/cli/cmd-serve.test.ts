import { describe, expect, it } from "bun:test";

import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { DEFAULT_HOST, DEFAULT_PORT, parseServeRest } from "./cmd-serve";

describe("parseServeRest", () => {
  it("returns run with defaults when no flags", () => {
    const r = parseServeRest(["serve"]);
    expect(r).toEqual({
      kind: "run",
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      token: undefined,
      watch: false,
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
      watch: false,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    });
  });

  it("throws if rest[0] is not 'serve'", () => {
    expect(() => parseServeRest(["query"])).toThrow();
  });

  it("parses --watch", () => {
    const r = parseServeRest(["serve", "--watch"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.watch).toBe(true);
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
