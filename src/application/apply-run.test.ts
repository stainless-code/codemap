import { describe, expect, test } from "bun:test";

import type { ApplyJsonPayload } from "./apply-engine";
import { gitCommitAfterApplyIfEligible } from "./apply-run";

function payload(overrides: Partial<ApplyJsonPayload> = {}): ApplyJsonPayload {
  return {
    mode: "apply",
    applied: true,
    files: [{ file_path: "src/a.ts", rows_applied: 1 }],
    conflicts: [],
    summary: {
      files: 1,
      files_modified: 1,
      rows: 1,
      rows_applied: 1,
      conflicts: 0,
      files_with_conflicts: 0,
    },
    ...overrides,
  };
}

describe("gitCommitAfterApplyIfEligible", () => {
  test("skips when not applied", () => {
    expect(
      gitCommitAfterApplyIfEligible({
        projectRoot: "/tmp",
        message: "m",
        payload: payload({ applied: false }),
      }),
    ).toBeUndefined();
  });

  test("rejects fixpoint cap", () => {
    const err = gitCommitAfterApplyIfEligible({
      projectRoot: "/tmp",
      message: "m",
      payload: payload({ terminated_by: "cap", passes: 1 }),
    });
    expect(err).toContain('terminated_by "empty"');
    expect(err).toContain("cap");
  });

  test("allows single-pass apply without terminated_by", () => {
    expect(
      gitCommitAfterApplyIfEligible({
        projectRoot: "/tmp/nonexistent-root-for-git",
        message: "m",
        payload: payload(),
      }),
    ).toContain("git");
  });
});
