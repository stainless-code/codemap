import { describe, expect, it } from "bun:test";
import { join } from "node:path";

/**
 * Locks scoped duplicate_count semantics (filtered CTE before GROUP BY).
 * Run via `bun run test:scripts`.
 */
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

describe("duplicates recipe scoped grouping", () => {
  it("path_prefix excludes collision groups with only one in-scope symbol", async () => {
    await $`bun src/index.ts --full --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
    const result =
      await $`bun src/index.ts query --recipe duplicates --json --params path_prefix=src/bench/duplicate-body-a.ts --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(
      rows.some((r) => r.file_path === "src/bench/duplicate-body-a.ts"),
    ).toBe(false);
  });

  it("path_prefix duplicate_count reflects in-scope peers only", async () => {
    await $`bun src/index.ts --full --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
    const result =
      await $`bun src/index.ts query --recipe duplicates --json --params path_prefix=src/bench/duplicate-body- --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    const alpha = rows.find((r) => r.name === "duplicateAlpha");
    const beta = rows.find((r) => r.name === "duplicateBeta");
    expect(alpha?.duplicate_count).toBe(2);
    expect(beta?.duplicate_count).toBe(2);
  });

  it("scoped duplicate_count is below global when prefix trims the group", async () => {
    await $`bun src/index.ts --full --root fixtures/minimal`
      .cwd(REPO_ROOT)
      .quiet();
    const globalResult =
      await $`bun src/index.ts query --recipe duplicates --json --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    const scopedResult =
      await $`bun src/index.ts query --recipe duplicates --json --params path_prefix=src/bench/homonym-helper- --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(globalResult.exitCode).toBe(0);
    expect(scopedResult.exitCode).toBe(0);
    const globalRows = JSON.parse(globalResult.stdout.toString());
    const scopedRows = JSON.parse(scopedResult.stdout.toString());
    const globalHelper = globalRows.find(
      (r) => r.file_path === "src/bench/homonym-helper-a.ts",
    );
    const scopedHelper = scopedRows.find(
      (r) => r.file_path === "src/bench/homonym-helper-a.ts",
    );
    expect(globalHelper?.duplicate_count).toBeGreaterThan(2);
    expect(scopedHelper?.duplicate_count).toBe(2);
  });
});
