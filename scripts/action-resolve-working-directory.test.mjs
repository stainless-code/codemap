/**
 * Tests `scripts/action-resolve-working-directory.sh` — same logic as action.yml
 * detect-pm WORKING_DIRECTORY resolution.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "action-resolve-working-directory.sh");
chmodSync(SCRIPT, 0o755);

function resolve(workspace, workDir) {
  const args = [SCRIPT, workspace];
  if (workDir !== undefined) args.push(workDir);
  const result = spawnSync("bash", args, { encoding: "utf8" });
  return result;
}

describe("action-resolve-working-directory.sh", () => {
  it("uses GITHUB_WORKSPACE when working-directory is empty", () => {
    const result = resolve("/repo", "");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/repo");
  });

  it("uses GITHUB_WORKSPACE when working-directory is .", () => {
    const result = resolve("/repo", ".");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/repo");
  });

  it("joins relative subdirectory under GITHUB_WORKSPACE", () => {
    const result = resolve("/repo", "apps/web");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/repo/apps/web");
  });

  it("rejects .. in working-directory", () => {
    const result = resolve("/repo", "../etc");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not contain ..");
  });

  it("does not escape workspace for absolute-looking segments", () => {
    const result = resolve("/repo", "/etc");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("/repo//etc");
  });
});
