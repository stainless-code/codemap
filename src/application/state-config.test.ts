import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureStateConfig } from "./state-config";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "codemap-cfg-"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("ensureStateConfig — self-healing JSON reconciler (D8 + D11)", () => {
  it("no-op when no config file exists", () => {
    const r = ensureStateConfig(stateDir);
    expect(r).toEqual({ found: undefined, written: false, warnings: [] });
  });

  it("steady-state: well-formed JSON with sorted keys is not rewritten", () => {
    const body = `${JSON.stringify(
      { include: ["**/*.ts"], tsconfigPath: "tsconfig.json" },
      null,
      2,
    )}\n`;
    writeFileSync(join(stateDir, "config.json"), body, "utf-8");
    const r = ensureStateConfig(stateDir);
    expect(r.written).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(readFileSync(join(stateDir, "config.json"), "utf-8")).toBe(body);
  });

  it("normalises key order alphabetically (drift → write)", () => {
    const unsorted = `${JSON.stringify(
      { tsconfigPath: "tsconfig.json", include: ["**/*.ts"] },
      null,
      2,
    )}\n`;
    writeFileSync(join(stateDir, "config.json"), unsorted, "utf-8");
    const r = ensureStateConfig(stateDir);
    expect(r.written).toBe(true);
    const after = readFileSync(join(stateDir, "config.json"), "utf-8");
    expect(after.indexOf("include")).toBeLessThan(
      after.indexOf("tsconfigPath"),
    );
  });

  it("prunes unknown keys with a warning", () => {
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ include: ["**/*.ts"], bogus: 1 }, null, 2),
      "utf-8",
    );
    const r = ensureStateConfig(stateDir);
    expect(r.written).toBe(true);
    expect(r.warnings.some((w) => w.includes("bogus"))).toBe(true);
    const after = JSON.parse(
      readFileSync(join(stateDir, "config.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect("bogus" in after).toBe(false);
    expect(after.include).toEqual(["**/*.ts"]);
  });

  it("warns + leaves file alone on invalid JSON", () => {
    writeFileSync(join(stateDir, "config.json"), "{not json", "utf-8");
    const r = ensureStateConfig(stateDir);
    expect(r.written).toBe(false);
    expect(r.warnings[0]).toContain("invalid JSON");
    expect(readFileSync(join(stateDir, "config.json"), "utf-8")).toBe(
      "{not json",
    );
  });

  it("warns on schema violation (e.g. wrong type) without writing", () => {
    writeFileSync(
      join(stateDir, "config.json"),
      JSON.stringify({ include: "not-an-array" }, null, 2),
      "utf-8",
    );
    const r = ensureStateConfig(stateDir);
    expect(r.written).toBe(false);
    expect(r.warnings.some((w) => w.includes("include"))).toBe(true);
  });

  it("TS config path: validate-only — never rewrites user code", () => {
    const userCode = `export default { include: ["**/*.ts"] }\n`;
    writeFileSync(join(stateDir, "config.ts"), userCode, "utf-8");
    const r = ensureStateConfig(stateDir);
    expect(r).toMatchObject({ found: "config.ts", written: false });
    expect(readFileSync(join(stateDir, "config.ts"), "utf-8")).toBe(userCode);
  });

  it("config.ts wins over config.json (D8 search order)", () => {
    writeFileSync(join(stateDir, "config.ts"), `export default {}\n`, "utf-8");
    writeFileSync(join(stateDir, "config.json"), `{}`, "utf-8");
    const r = ensureStateConfig(stateDir);
    expect(r.found).toBe("config.ts");
  });
});
