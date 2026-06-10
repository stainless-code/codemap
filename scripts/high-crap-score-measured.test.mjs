import { describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plan 2 slice 2.2 — measured coverage overrides graph tiers when ingest ran.
 * Run via `bun run test:scripts` (golden runner already ingests coverage in setup).
 */
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

describe("high-crap-score measured override", () => {
  it("uses coverage_source measured when coverage row exists (now @ 100%)", async () => {
    await $`bun src/index.ts ingest-coverage coverage/coverage-final.json --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
    const result =
      await $`bun src/index.ts query --recipe high-crap-score --json --params min_crap=1 --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    const nowRow = rows.find(
      (r) => r.name === "now" && r.file_path === "src/utils/date.ts",
    );
    expect(nowRow).toBeDefined();
    expect(nowRow.coverage_source).toBe("measured");
    expect(nowRow.effective_coverage_pct).toBe(100);
  });

  it("measured 0% overrides graph estimated tier (labyrinth @ 85% without ingest)", async () => {
    await $`rm -f fixtures/minimal/.codemap/index.db fixtures/minimal/.codemap/index.db-shm fixtures/minimal/.codemap/index.db-wal`
      .cwd(REPO_ROOT)
      .quiet();
    await $`bun src/index.ts --full --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();

    const before =
      await $`bun src/index.ts query --recipe high-crap-score --json --params min_crap=1 --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(before.exitCode).toBe(0);
    const beforeRows = JSON.parse(before.stdout.toString());
    const labBefore = beforeRows.find(
      (r) =>
        r.name === "labyrinth" &&
        r.file_path === "src/lib/complexity-fixture.ts",
    );
    expect(labBefore).toBeDefined();
    expect(labBefore.coverage_source).toBe("estimated");
    expect(labBefore.effective_coverage_pct).toBe(85);

    const overlayPath = join(
      REPO_ROOT,
      "fixtures/minimal/coverage/coverage-labyrinth-zero.json",
    );
    writeFileSync(
      overlayPath,
      JSON.stringify({
        "src/lib/complexity-fixture.ts": {
          path: "src/lib/complexity-fixture.ts",
          statementMap: {
            0: {
              start: { line: 25, column: 0 },
              end: { line: 25, column: 1 },
            },
          },
          s: { 0: 0 },
        },
      }),
    );
    await $`bun src/index.ts ingest-coverage coverage/coverage-labyrinth-zero.json --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();

    const after =
      await $`bun src/index.ts query --recipe high-crap-score --json --params min_crap=1 --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(after.exitCode).toBe(0);
    const afterRows = JSON.parse(after.stdout.toString());
    const labAfter = afterRows.find(
      (r) =>
        r.name === "labyrinth" &&
        r.file_path === "src/lib/complexity-fixture.ts",
    );
    expect(labAfter).toBeDefined();
    expect(labAfter.coverage_source).toBe("measured");
    expect(labAfter.effective_coverage_pct).toBe(0);

    unlinkSync(overlayPath);
    await $`rm -f fixtures/minimal/.codemap/index.db fixtures/minimal/.codemap/index.db-shm fixtures/minimal/.codemap/index.db-wal`
      .cwd(REPO_ROOT)
      .quiet();
    await $`bun src/index.ts --full --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
    await $`bun src/index.ts ingest-coverage coverage/coverage-final.json --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
  });
});
