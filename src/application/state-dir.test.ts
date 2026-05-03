import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  ensureStateGitignore,
  resolveStateDir,
  STATE_CONFIG_BASENAMES,
  STATE_DB_NAME,
  STATE_DIR_DEFAULT,
  STATE_GITIGNORE_BODY,
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

describe("ensureStateGitignore — self-healing reconciler (D11)", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "codemap-state-")) + "/.codemap";
  });

  afterEach(() => {
    rmSync(stateDir + "/..", { recursive: true, force: true });
  });

  it("creates the file when absent (and mkdirs the state-dir)", () => {
    expect(existsSync(stateDir)).toBe(false);
    const r = ensureStateGitignore(stateDir);
    expect(r).toEqual({
      before: undefined,
      after: STATE_GITIGNORE_BODY,
      written: true,
    });
    expect(readFileSync(join(stateDir, ".gitignore"), "utf-8")).toBe(
      STATE_GITIGNORE_BODY,
    );
  });

  it("steady-state run is a no-op (drift-detect)", () => {
    ensureStateGitignore(stateDir);
    const r = ensureStateGitignore(stateDir);
    expect(r.written).toBe(false);
    expect(r.before).toBe(STATE_GITIGNORE_BODY);
    expect(r.after).toBe(STATE_GITIGNORE_BODY);
  });

  it("rewrites a user-modified file back to canonical (overwrite by design)", () => {
    ensureStateGitignore(stateDir);
    writeFileSync(join(stateDir, ".gitignore"), "rogue content\n", "utf-8");
    const r = ensureStateGitignore(stateDir);
    expect(r.written).toBe(true);
    expect(r.before).toBe("rogue content\n");
    expect(r.after).toBe(STATE_GITIGNORE_BODY);
  });

  it("self-heals when an older codemap version's content is missing today's entries", () => {
    // Older shape — pre-audit-cache: only the DB lines.
    const olderBody =
      "# old codemap-managed file\nindex.db\nindex.db-shm\nindex.db-wal\n";
    const { mkdirSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, ".gitignore"), olderBody, "utf-8");
    const r = ensureStateGitignore(stateDir);
    expect(r.written).toBe(true);
    expect(r.after).toContain("audit-cache/");
  });

  it("returned `after` matches the file on disk", () => {
    const r = ensureStateGitignore(stateDir);
    expect(r.after).toBe(readFileSync(join(stateDir, ".gitignore"), "utf-8"));
  });
});
