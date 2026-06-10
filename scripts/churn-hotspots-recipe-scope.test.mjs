import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

async function indexAndSeedChurn() {
  await $`bun src/index.ts --full --root fixtures/minimal`
    .cwd(REPO_ROOT)
    .quiet();
  await $`bun src/index.ts ingest-churn file-churn-seed.json --root fixtures/minimal`
    .cwd(REPO_ROOT)
    .quiet();
}

describe("churn-complexity-hotspots path_prefix", () => {
  it("path_prefix excludes files outside the subtree", async () => {
    await indexAndSeedChurn();
    const result =
      await $`bun src/index.ts query --recipe churn-complexity-hotspots --json --params path_prefix=src/lib/ --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    expect(rows.every((r) => r.file_path.startsWith("src/lib/"))).toBe(true);
    expect(rows.some((r) => r.file_path === "src/api/client.ts")).toBe(false);
    expect(rows.map((r) => r.file_path)).toEqual([
      "src/lib/complexity-fixture.ts",
      "src/lib/cache.ts",
    ]);
  });
});
