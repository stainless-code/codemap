import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { installCodemapTestTeardown } from "./test-helpers/runtime-reset";

installCodemapTestTeardown();

import { resolveCodemapConfig } from "./config";
import { globSync } from "./glob-sync";
import { initCodemap } from "./runtime";
import {
  parseFilesParallel,
  parseParseWorkerCountOverride,
  parseWorkerRecycleEvery,
} from "./worker-pool";

const repoRoot = join(import.meta.dir, "..");
const minimalRoot = join(repoRoot, "fixtures", "minimal");
/** Mirrors `INLINE_PARSE_MAX` in `worker-pool.ts`. */
const WORKER_POOL_INLINE_PARSE_MAX = 12;

describe("parseParseWorkerCountOverride", () => {
  test("accepts valid decimal integers", () => {
    expect(parseParseWorkerCountOverride("2")).toBe(2);
    expect(parseParseWorkerCountOverride("32")).toBe(32);
    expect(parseParseWorkerCountOverride("999")).toBe(32);
  });

  test("rejects malformed or non-positive values", () => {
    expect(parseParseWorkerCountOverride("2abc")).toBeNull();
    expect(parseParseWorkerCountOverride("1.5")).toBeNull();
    expect(parseParseWorkerCountOverride("0")).toBeNull();
    expect(parseParseWorkerCountOverride("-1")).toBeNull();
    expect(parseParseWorkerCountOverride(" 2")).toBeNull();
  });

  test("treats unset or empty as no override", () => {
    expect(parseParseWorkerCountOverride(undefined)).toBeNull();
    expect(parseParseWorkerCountOverride("")).toBeNull();
  });
});

describe("parseWorkerRecycleEvery", () => {
  test("defaults when unset", () => {
    expect(parseWorkerRecycleEvery(undefined)).toBe(250);
  });

  test("accepts positive integers", () => {
    expect(parseWorkerRecycleEvery("100")).toBe(100);
  });
});

describe("parseFilesParallel", () => {
  test("resolves immediately for an empty file list", async () => {
    await expect(parseFilesParallel([])).resolves.toEqual([]);
  });

  test("returns parsed results via the worker pool path", async () => {
    initCodemap(resolveCodemapConfig(minimalRoot, undefined));
    const files = globSync(["**/*.ts", "**/*.tsx", "**/*.css"], minimalRoot);
    expect(files.length).toBeGreaterThan(WORKER_POOL_INLINE_PARSE_MAX);

    const results = await parseFilesParallel(files);
    expect(results.length).toBe(files.length);
  });

  test("subprocess exits promptly after worker-pool parse (no orphaned timers)", async () => {
    const files = globSync(["**/*.ts", "**/*.tsx", "**/*.css"], minimalRoot);
    expect(files.length).toBeGreaterThan(WORKER_POOL_INLINE_PARSE_MAX);

    const script = `
import { resolveCodemapConfig } from "./src/config.ts";
import { globSync } from "./src/glob-sync.ts";
import { initCodemap } from "./src/runtime.ts";
import { parseFilesParallel } from "./src/worker-pool.ts";

const inlineParseMax = ${WORKER_POOL_INLINE_PARSE_MAX};
const root = ${JSON.stringify(minimalRoot)};
initCodemap(resolveCodemapConfig(root, undefined));
const files = globSync(["**/*.ts", "**/*.tsx", "**/*.css"], root);
if (files.length <= inlineParseMax) {
  throw new Error("fixture too small for worker-pool path");
}
await parseFilesParallel(files);
`;

    const proc = Bun.spawn([process.execPath, "-e", script], {
      cwd: repoRoot,
      stdout: "ignore",
      stderr: "pipe",
    });
    const hangMs = 6_000;
    const exitOrHang = await Promise.race([
      proc.exited.then((code) => ({ kind: "exit" as const, code })),
      Bun.sleep(hangMs).then(async () => {
        proc.kill();
        await proc.exited;
        return { kind: "hang" as const };
      }),
    ]);
    const stderr = await new Response(proc.stderr).text();

    expect(exitOrHang.kind).toBe("exit");
    if (exitOrHang.kind === "exit") {
      expect(exitOrHang.code).toBe(0);
    }
    expect(stderr).toBe("");
  }, 8_000);
});
