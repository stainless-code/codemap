/**
 * Unit tests for `scripts/detect-pm.mjs`. Spawns the script as a child
 * process with controlled `WORKING_DIRECTORY` + `PACKAGE_MANAGER` +
 * `VERSION` env vars; asserts on stdout (when `GITHUB_OUTPUT` is unset
 * the script prints `key=value\n` lines to stdout for inspection).
 *
 * Lockfile fixtures live under `fixtures/detect-pm/<scenario>/` so the
 * test doesn't have to touch the actual repo's lockfile state.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "detect-pm.mjs");
let workRoot;

beforeAll(() => {
  workRoot = join(tmpdir(), `detect-pm-test-${process.pid}`);
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
});

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function makeFixture(name, files) {
  const dir = join(workRoot, name);
  mkdirSync(dir, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

function runDetect(env) {
  const result = spawnSync("node", [SCRIPT], {
    env: { ...process.env, GITHUB_OUTPUT: "", ...env },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `detect-pm exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  const out = {};
  for (const line of result.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe("scripts/detect-pm.mjs", () => {
  it("detects pnpm from pnpm-lock.yaml", () => {
    const dir = makeFixture("pnpm-fixture", {
      "package.json": "{}",
      "pnpm-lock.yaml": "lockfileVersion: 6.0\n",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("pnpm");
    expect(out.exec).toContain("pnpm");
    expect(out.install_method).toBe("dlx-latest");
  });

  it("detects bun from bun.lock", () => {
    const dir = makeFixture("bun-fixture", {
      "package.json": "{}",
      "bun.lock": "",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("bun");
    expect(out.install_method).toBe("dlx-latest");
  });

  it("falls back to npm when no lockfile exists", () => {
    const dir = makeFixture("no-lockfile-fixture", {
      "package.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("npm");
    expect(out.install_method).toBe("dlx-latest");
  });

  it("uses execute-local when codemap is in devDependencies", () => {
    const dir = makeFixture("dev-dep-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { codemap: "^1.0.0" },
      }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("npm");
    expect(out.install_method).toBe("project-installed");
    expect(out.exec).toContain("codemap");
    expect(out.exec).not.toContain("codemap@");
  });

  it("uses dlx-pinned when version input is set (overrides project install)", () => {
    const dir = makeFixture("pinned-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { codemap: "^1.0.0" },
      }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir, VERSION: "1.2.3" });
    expect(out.install_method).toBe("dlx-pinned");
    expect(out.exec).toContain("codemap@1.2.3");
  });

  it("respects PACKAGE_MANAGER override", () => {
    const dir = makeFixture("override-fixture", {
      "package.json": "{}",
      "pnpm-lock.yaml": "",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir, PACKAGE_MANAGER: "yarn" });
    expect(out.agent).toBe("yarn");
  });

  it("rejects unknown PACKAGE_MANAGER values", () => {
    const dir = makeFixture("bad-pm-fixture", {
      "package.json": "{}",
    });
    const result = spawnSync("node", [SCRIPT], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: "",
        WORKING_DIRECTORY: dir,
        PACKAGE_MANAGER: "rye",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("rye");
  });

  it("respects packageManager field over lockfile when both present", () => {
    // Per `package-manager-detector` strategy order — `packageManager-field`
    // wins over `lockfile`. Useful for monorepos that have a stale
    // package-lock.json but officially use pnpm via corepack.
    const dir = makeFixture("packageManager-field-fixture", {
      "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("pnpm");
  });
});
