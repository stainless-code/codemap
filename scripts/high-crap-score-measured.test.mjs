import { describe, expect, it } from "bun:test";
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
});
