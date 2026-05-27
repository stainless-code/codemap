/**
 * TS ↔ mjs resolver parity — catches drift between `src/codemap-invocation.ts`
 * and `scripts/codemap-invocation.mjs`.
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildCodemapMcpSpawn as spawnFromTs,
  resolveCodemapCliInvocation as resolveFromTs,
} from "../src/codemap-invocation.ts";
import {
  buildCodemapMcpSpawn as spawnFromMjs,
  resolveCodemapCliInvocation as resolveFromMjs,
} from "./codemap-invocation.mjs";

let workRoot;

beforeAll(() => {
  workRoot = join(tmpdir(), `codemap-invocation-sync-${process.pid}`);
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
});

afterAll(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

function makeFixture(name, files) {
  const dir = join(workRoot, name);
  for (const [path, contents] of Object.entries(files)) {
    const filePath = join(dir, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return dir;
}

/** @type {Array<{ label: string; fixture: Record<string, string>; opts: { projectRoot: string; packageManager?: string; version?: string } }>} */
const CASES = [
  {
    label: "pnpm execute-local",
    fixture: {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
    },
    opts: { projectRoot: "", packageManager: "pnpm" },
  },
  {
    label: "npm dlx-latest",
    fixture: {
      "package.json": JSON.stringify({ name: "empty" }),
      "package-lock.json": "{}",
    },
    opts: { projectRoot: "", packageManager: "npm" },
  },
  {
    label: "bun bunx local",
    fixture: {
      "package.json": JSON.stringify({
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "bun.lock": "",
    },
    opts: { projectRoot: "", packageManager: "bun" },
  },
  {
    label: "yarn berry exec local",
    fixture: {
      "package.json": JSON.stringify({
        packageManager: "yarn@berry@4.0.0",
        devDependencies: { "@stainless-code/codemap": "^1.0.0" },
      }),
      "yarn.lock": "",
    },
    opts: { projectRoot: "", packageManager: "yarn@berry" },
  },
];

describe("codemap-invocation TS ↔ mjs sync", () => {
  for (const testCase of CASES) {
    it(`resolveCodemapCliInvocation: ${testCase.label}`, async () => {
      const dir = makeFixture(
        testCase.label.replace(/\s+/g, "-"),
        testCase.fixture,
      );
      const opts = { ...testCase.opts, projectRoot: dir };
      const ts = await resolveFromTs(opts);
      const mjs = await resolveFromMjs(opts);
      expect(mjs).toEqual(ts);
    });
  }

  it("buildCodemapMcpSpawn matches", () => {
    const prefix = { command: "npx", args: ["codemap"] };
    expect(spawnFromMjs(prefix, true)).toEqual(spawnFromTs(prefix, true));
    expect(spawnFromMjs(prefix, false)).toEqual(spawnFromTs(prefix, false));
  });
});
