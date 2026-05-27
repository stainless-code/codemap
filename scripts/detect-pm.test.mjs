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
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const SCRIPT = join(import.meta.dirname, "detect-pm.mjs");
const REPO_NODE_MODULES = join(import.meta.dirname, "..", "node_modules");
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
    const filePath = join(dir, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
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

function runDetectFail(env) {
  return spawnSync("node", [SCRIPT], {
    env: { ...process.env, GITHUB_OUTPUT: "", ...env },
    encoding: "utf8",
  });
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

  it("uses execute-local when @stainless-code/codemap is in devDependencies (scoped name)", () => {
    const dir = makeFixture("scoped-dev-dep-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.agent).toBe("npm");
    expect(out.install_method).toBe("project-installed");
    // bin alias is `codemap` regardless of the scoped package name
    expect(out.exec).toContain("codemap");
    expect(out.exec).not.toContain("@stainless-code/codemap@");
  });

  it("uses bunx (not bun x) for bun execute-local", () => {
    const dir = makeFixture("bun-local-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "bun.lock": "",
    });
    const out = runDetect({
      WORKING_DIRECTORY: dir,
      PACKAGE_MANAGER: "bun",
    });
    expect(out.install_method).toBe("project-installed");
    expect(out.exec).toBe("bunx codemap");
  });

  it("uses execute-local when bare `codemap` key is set (workspace alias case)", () => {
    const dir = makeFixture("bare-dev-dep-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { codemap: "workspace:*" },
      }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir });
    expect(out.install_method).toBe("project-installed");
  });

  it("uses dlx-pinned with scoped published name when version input is set", () => {
    const dir = makeFixture("pinned-fixture", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "package-lock.json": "{}",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir, VERSION: "1.2.3" });
    expect(out.install_method).toBe("dlx-pinned");
    // dlx must use the scoped name so the right registry entry resolves
    expect(out.exec).toContain("@stainless-code/codemap@1.2.3");
  });

  it("respects PACKAGE_MANAGER override", () => {
    const dir = makeFixture("override-fixture", {
      "package.json": "{}",
      "pnpm-lock.yaml": "",
    });
    const out = runDetect({ WORKING_DIRECTORY: dir, PACKAGE_MANAGER: "yarn" });
    expect(out.agent).toBe("yarn");
  });

  it("rejects VERSION with shell metacharacters", () => {
    const dir = makeFixture("bad-version-semicolon", { "package.json": "{}" });
    const result = runDetectFail({
      WORKING_DIRECTORY: dir,
      VERSION: "1.0;id",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid characters");
  });

  it("rejects VERSION with embedded newline", () => {
    const dir = makeFixture("bad-version-newline", { "package.json": "{}" });
    const result = runDetectFail({
      WORKING_DIRECTORY: dir,
      VERSION: "1.0\nexec=evil",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/line breaks|invalid characters/);
  });

  it("writes GITHUB_OUTPUT as single-line keys for a pinned VERSION", () => {
    const dir = makeFixture("github-output-fixture", {
      "package.json": "{}",
      "package-lock.json": "{}",
    });
    const outputPath = join(workRoot, "github-output.txt");
    writeFileSync(outputPath, "");
    const result = spawnSync("node", [SCRIPT], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        WORKING_DIRECTORY: dir,
        VERSION: "1.2.3",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const content = readFileSync(outputPath, "utf8");
    expect(content).toContain("exec=");
    expect(content).toContain("@stainless-code/codemap@1.2.3");
    expect(content).not.toContain("exec=evil");
    expect(content.match(/^agent=/gm)?.length).toBe(1);
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

  it("runs from an Action-style isolated stage with both script files", () => {
    const stage = join(workRoot, "action-stage");
    mkdirSync(stage, { recursive: true });
    copyFileSync(
      join(import.meta.dirname, "detect-pm.mjs"),
      join(stage, "detect-pm.mjs"),
    );
    copyFileSync(
      join(import.meta.dirname, "codemap-invocation.mjs"),
      join(stage, "codemap-invocation.mjs"),
    );
    symlinkSync(REPO_NODE_MODULES, join(stage, "node_modules"), "dir");
    const dir = makeFixture("action-stage-project", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "package-lock.json": "{}",
    });
    const result = spawnSync("node", ["detect-pm.mjs"], {
      cwd: stage,
      env: {
        ...process.env,
        GITHUB_OUTPUT: "",
        WORKING_DIRECTORY: dir,
      },
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `detect-pm action stage exited ${result.status}: ${result.stderr || result.stdout}`,
      );
    }
    expect(result.stdout).toContain("agent=npm");
    expect(result.stdout).toContain("install_method=project-installed");
  });

  it("resolve walk-up from monorepo child via absolute WORKING_DIRECTORY", () => {
    const root = makeFixture("monorepo-detect-pm", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "package-lock.json": "{}",
      "apps/web/package.json": JSON.stringify({ name: "web" }),
    });
    const out = runDetect({
      WORKING_DIRECTORY: join(root, "apps", "web"),
      PACKAGE_MANAGER: "npm",
    });
    expect(out.install_method).toBe("project-installed");
    expect(out.exec).toContain("codemap");
  });
});
