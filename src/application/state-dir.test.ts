import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  resolveStateDir,
  STATE_CONFIG_BASENAMES,
  STATE_DB_NAME,
  STATE_DIR_DEFAULT,
  STATE_GITIGNORE_NAME,
} from "./state-dir";

const ROOT = resolve(tmpdir(), "codemap-state-dir-test");

describe("resolveStateDir — precedence", () => {
  it("defaults to <root>/.codemap when nothing supplied", () => {
    expect(resolveStateDir({ root: ROOT })).toBe(join(ROOT, ".codemap"));
  });

  it("uses env when set", () => {
    expect(resolveStateDir({ root: ROOT, env: ".cm" })).toBe(join(ROOT, ".cm"));
  });

  it("uses cliFlag when set, ignoring env (flag wins)", () => {
    expect(
      resolveStateDir({ root: ROOT, cliFlag: ".override", env: ".cm" }),
    ).toBe(join(ROOT, ".override"));
  });

  it("treats absolute cliFlag as-is (no resolve against root)", () => {
    const abs = "/tmp/elsewhere/codemap-state";
    expect(resolveStateDir({ root: ROOT, cliFlag: abs })).toBe(abs);
  });

  it("treats absolute env as-is", () => {
    const abs = "/var/cache/codemap";
    expect(resolveStateDir({ root: ROOT, env: abs })).toBe(abs);
  });

  it("nested relative path resolves against root", () => {
    expect(resolveStateDir({ root: ROOT, cliFlag: "build/codemap" })).toBe(
      join(ROOT, "build/codemap"),
    );
  });
});

describe("constants", () => {
  it("default state-dir name is '.codemap'", () => {
    expect(STATE_DIR_DEFAULT).toBe(".codemap");
  });
  it("DB name is 'index.db'", () => {
    expect(STATE_DB_NAME).toBe("index.db");
  });
  it("gitignore name is '.gitignore'", () => {
    expect(STATE_GITIGNORE_NAME).toBe(".gitignore");
  });
  it("config basenames are tried in ts → js → json order", () => {
    expect([...STATE_CONFIG_BASENAMES]).toEqual([
      "config.ts",
      "config.js",
      "config.json",
    ]);
  });
});
