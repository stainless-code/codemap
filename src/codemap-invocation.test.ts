import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildCodemapMcpSpawn,
  codemapInProjectDependencies,
  normalizeSpawnCommand,
  resolveCodemapCliInvocation,
} from "./codemap-invocation";

let workRoot: string;

beforeAll(() => {
  workRoot = join(tmpdir(), `codemap-invocation-test-${process.pid}`);
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
});

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function makeFixture(name: string, files: Record<string, string>): string {
  const dir = join(workRoot, name);
  for (const [path, contents] of Object.entries(files)) {
    const filePath = join(dir, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return dir;
}

describe("normalizeSpawnCommand", () => {
  it("rewrites bun x to bunx", () => {
    expect(normalizeSpawnCommand("bun", ["x", "codemap"])).toEqual({
      command: "bunx",
      args: ["codemap"],
    });
  });

  it("passes through other commands", () => {
    expect(normalizeSpawnCommand("pnpm", ["exec", "codemap"])).toEqual({
      command: "pnpm",
      args: ["exec", "codemap"],
    });
  });
});

describe("codemapInProjectDependencies", () => {
  it("finds scoped devDependency in project root", () => {
    const dir = makeFixture("scoped-root", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
    });
    expect(codemapInProjectDependencies(dir)).toBe(true);
  });

  it("walks up to parent package.json", () => {
    const dir = makeFixture("monorepo-child", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "apps/web/package.json": JSON.stringify({ name: "web" }),
    });
    expect(codemapInProjectDependencies(join(dir, "apps", "web"))).toBe(true);
  });

  it("returns false when no manifest lists codemap", () => {
    const dir = makeFixture("no-dep", {
      "package.json": JSON.stringify({ name: "empty" }),
    });
    expect(codemapInProjectDependencies(dir)).toBe(false);
  });
});

describe("resolveCodemapCliInvocation", () => {
  it("uses execute-local when codemap is a project dependency", async () => {
    const dir = makeFixture("pnpm-local", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
    });
    const resolved = await resolveCodemapCliInvocation({
      projectRoot: dir,
      packageManager: "pnpm",
    });
    expect(resolved.installMethod).toBe("project-installed");
    expect(resolved.command).toBe("pnpm");
    expect(resolved.args).toEqual(["exec", "codemap"]);
  });

  it("uses bunx for bun execute-local", async () => {
    const dir = makeFixture("bun-local", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "bun.lock": "",
    });
    const resolved = await resolveCodemapCliInvocation({
      projectRoot: dir,
      packageManager: "bun",
    });
    expect(resolved.installMethod).toBe("project-installed");
    expect(resolved.command).toBe("bunx");
    expect(resolved.args).toEqual(["codemap"]);
  });

  it("uses yarn exec for yarn execute-local", async () => {
    const dir = makeFixture("yarn-local", {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "yarn.lock": "",
    });
    const resolved = await resolveCodemapCliInvocation({
      projectRoot: dir,
      packageManager: "yarn",
    });
    expect(resolved.installMethod).toBe("project-installed");
    expect(resolved.command).toBe("yarn");
    expect(resolved.args).toEqual(["exec", "codemap"]);
  });

  it("uses dlx-latest when codemap is not installed locally", async () => {
    const dir = makeFixture("dlx-fallback", {
      "package.json": JSON.stringify({ name: "no-codemap" }),
      "package-lock.json": "{}",
    });
    const resolved = await resolveCodemapCliInvocation({
      projectRoot: dir,
      packageManager: "npm",
    });
    expect(resolved.installMethod).toBe("dlx-latest");
    expect(resolved.command).toBe("npx");
    expect(resolved.args).toEqual(["@stainless-code/codemap@latest"]);
  });

  it("uses yarn berry exec for execute-local", async () => {
    const dir = makeFixture("yarn-berry-local", {
      "package.json": JSON.stringify({
        packageManager: "yarn@berry@4.0.0",
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "yarn.lock": "",
    });
    const resolved = await resolveCodemapCliInvocation({
      projectRoot: dir,
      packageManager: "yarn@berry",
    });
    expect(resolved.installMethod).toBe("project-installed");
    expect(resolved.command).toBe("yarn");
    expect(resolved.args[0]).toBe("exec");
    expect(resolved.args).toContain("codemap");
  });

  it("rejects VERSION with shell metacharacters", async () => {
    const dir = makeFixture("version-bad-char", {
      "package.json": JSON.stringify({ name: "x" }),
    });
    await expect(
      resolveCodemapCliInvocation({
        projectRoot: dir,
        packageManager: "npm",
        version: "1.0.0;",
      }),
    ).rejects.toThrow(/invalid characters/);
  });

  it("rejects VERSION with embedded newline", async () => {
    const dir = makeFixture("version-newline", {
      "package.json": JSON.stringify({ name: "x" }),
    });
    await expect(
      resolveCodemapCliInvocation({
        projectRoot: dir,
        packageManager: "npm",
        version: "1.0.0\nlatest",
      }),
    ).rejects.toThrow(/line breaks/);
  });
});

describe("buildCodemapMcpSpawn", () => {
  it("appends MCP tail args after invocation prefix", () => {
    expect(
      buildCodemapMcpSpawn({ command: "bunx", args: ["codemap"] }, true),
    ).toEqual({
      command: "bunx",
      args: ["codemap", "mcp", "--watch", "--root", "${workspaceFolder}"],
    });
  });
});
