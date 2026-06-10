import { describe, expect, it } from "bun:test";
/**
 * Plan 2 slice 2.0 — locks reachability tier counts on fixtures/minimal.
 * Run via `bun run test:scripts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");
const SPIKE_SQL = readFileSync(
  join(REPO_ROOT, "scripts/spike-crap-reachability.sql"),
  "utf-8",
);

describe("spike-crap-reachability (fixtures/minimal)", () => {
  it("assigns 85/40/0% tiers to 1/4/41 function-shaped symbols", async () => {
    const result =
      await $`bun src/index.ts query --json ${SPIKE_SQL} --root fixtures/minimal`
        .cwd(REPO_ROOT)
        .quiet();
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout.toString());
    const byTier = Object.fromEntries(
      rows.map((r) => [r.estimated_pct, r.symbol_count]),
    );
    expect(byTier[85]).toBe(1);
    expect(byTier[40]).toBe(4);
    expect(byTier[0]).toBe(41);
  });
});
