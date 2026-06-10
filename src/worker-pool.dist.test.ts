/**
 * Node + dist regression for orphaned parse timers on `--full`.
 * Binary-level dist smoke also lives in `.github/workflows/ci.yml`.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globSync } from "./glob-sync";

const repoRoot = join(import.meta.dir, "..");
const minimalRoot = join(repoRoot, "fixtures", "minimal");
const distEntry = join(repoRoot, "dist", "index.mjs");
/** Mirrors `INLINE_PARSE_MAX` in `worker-pool.ts`. */
const WORKER_POOL_INLINE_PARSE_MAX = 12;

async function expectSubprocessExits(
  spawn: () => ReturnType<typeof Bun.spawn>,
): Promise<void> {
  const proc = spawn();
  const hangMs = 6_000;
  const exitOrHang = await Promise.race([
    proc.exited.then((code) => ({ kind: "exit" as const, code })),
    Bun.sleep(hangMs).then(async () => {
      proc.kill();
      await proc.exited;
      return { kind: "hang" as const };
    }),
  ]);

  expect(exitOrHang.kind).toBe("exit");
  if (exitOrHang.kind === "exit") {
    expect(exitOrHang.code).toBe(0);
  }
}

describe("node dist --full exit delay", () => {
  test.skipIf(!existsSync(distEntry))(
    "subprocess exits promptly after node dist --full (no orphaned timers)",
    async () => {
      const files = globSync(["**/*.ts", "**/*.tsx", "**/*.css"], minimalRoot);
      expect(files.length).toBeGreaterThan(WORKER_POOL_INLINE_PARSE_MAX);

      const stateDir = mkdtempSync(join(tmpdir(), "codemap-dist-full-"));
      try {
        await expectSubprocessExits(() =>
          Bun.spawn(["node", distEntry, "--full"], {
            cwd: repoRoot,
            env: {
              ...process.env,
              CODEMAP_ROOT: minimalRoot,
              CODEMAP_STATE_DIR: stateDir,
              // Prevent git from walking above the fixture (parent monorepo history).
              GIT_CEILING_DIRECTORIES: minimalRoot,
            },
            stdout: "ignore",
            stderr: "pipe",
          }),
        );
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    },
    8_000,
  );
});
