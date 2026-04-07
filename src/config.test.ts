import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_INCLUDE_PATTERNS,
  defineConfig,
  loadUserConfig,
  parseCodemapUserConfig,
  resolveCodemapConfig,
  type CodemapUserConfig,
} from "./config";

describe("parseCodemapUserConfig / defineConfig", () => {
  it("accepts an empty object", () => {
    expect(parseCodemapUserConfig({})).toEqual({});
  });

  it("rejects non-objects", () => {
    expect(() => parseCodemapUserConfig(null)).toThrow(TypeError);
    expect(() => parseCodemapUserConfig([])).toThrow(TypeError);
    expect(() => parseCodemapUserConfig("x")).toThrow(TypeError);
  });

  it("rejects unknown keys", () => {
    expect(() =>
      parseCodemapUserConfig({ include: ["**/*.ts"], extra: 1 }),
    ).toThrow(/Unrecognized key|extra/i);
  });

  it("rejects wrong array element types", () => {
    expect(() =>
      parseCodemapUserConfig({ include: ["**/*.ts", 1 as unknown as string] }),
    ).toThrow(/include/);
  });

  it("defineConfig validates like parseCodemapUserConfig", () => {
    expect(defineConfig({ databasePath: "db.sqlite" })).toEqual({
      databasePath: "db.sqlite",
    });
    expect(() => defineConfig({ bad: true } as CodemapUserConfig)).toThrow(
      /Unrecognized key|bad/i,
    );
  });
});

describe("resolveCodemapConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codemap-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults database path and include patterns", () => {
    const r = resolveCodemapConfig(dir, undefined);
    expect(r.root).toBe(dir);
    expect(r.databasePath).toBe(join(dir, ".codemap.db"));
    expect(r.include.length).toBe(DEFAULT_INCLUDE_PATTERNS.length);
    expect(r.excludeDirNames.has("node_modules")).toBe(true);
  });

  it("sets tsconfigPath when tsconfig.json exists", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const r = resolveCodemapConfig(dir, undefined);
    expect(r.tsconfigPath).toBe(join(dir, "tsconfig.json"));
  });

  it("sets tsconfigPath to null when tsconfig.json is missing", () => {
    const r = resolveCodemapConfig(dir, undefined);
    expect(r.tsconfigPath).toBeNull();
  });

  it("forces tsconfigPath null when user passes null", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    const r = resolveCodemapConfig(dir, { tsconfigPath: null });
    expect(r.tsconfigPath).toBeNull();
  });

  it("resolves explicit tsconfigPath", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "tsconfig.app.json"), "{}");
    const r = resolveCodemapConfig(dir, { tsconfigPath: "tsconfig.app.json" });
    expect(r.tsconfigPath).toBe(join(dir, "tsconfig.app.json"));
  });

  it("uses custom databasePath and include", () => {
    const user: CodemapUserConfig = {
      databasePath: "data.db",
      include: ["**/*.ts"],
    };
    const r = resolveCodemapConfig(dir, user);
    expect(r.databasePath).toBe(join(dir, "data.db"));
    expect(r.include).toEqual(["**/*.ts"]);
  });

  it("replaces default excludeDirNames when user provides a list", () => {
    const r = resolveCodemapConfig(dir, undefined);
    expect(r.excludeDirNames.has("dist")).toBe(true);
    const r2 = resolveCodemapConfig(dir, { excludeDirNames: ["custom"] });
    expect(r2.excludeDirNames.has("custom")).toBe(true);
    expect(r2.excludeDirNames.has("node_modules")).toBe(false);
  });
});

describe("loadUserConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codemap-load-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads codemap.config.json from project root", async () => {
    writeFileSync(
      join(dir, "codemap.config.json"),
      JSON.stringify({ include: ["**/*.ts"] }),
    );
    const cfg = await loadUserConfig(dir);
    expect(cfg?.include).toEqual(["**/*.ts"]);
  });

  it("loads explicit .json path via --config", async () => {
    const p = join(dir, "custom.json");
    writeFileSync(p, JSON.stringify({ databasePath: "data.db" }));
    const cfg = await loadUserConfig(dir, p);
    expect(cfg?.databasePath).toBe("data.db");
  });

  it("returns undefined when explicit json path is missing", async () => {
    const cfg = await loadUserConfig(dir, join(dir, "nope.json"));
    expect(cfg).toBeUndefined();
  });

  it("invalid JSON config throws when resolved", async () => {
    writeFileSync(
      join(dir, "codemap.config.json"),
      JSON.stringify({ include: [1, 2] }),
    );
    const cfg = await loadUserConfig(dir);
    expect(() => resolveCodemapConfig(dir, cfg)).toThrow(/include/);
  });
});
