import { describe, expect, it } from "bun:test";

import { assertApplyAutoFixable } from "./apply-policy";

describe("assertApplyAutoFixable", () => {
  it("blocks rename-preview without force", () => {
    const err = assertApplyAutoFixable({
      recipeId: "rename-preview",
      force: false,
    });
    expect(err).toBeUndefined();
  });

  it("blocks recipes without auto_fixable actions", () => {
    const err = assertApplyAutoFixable({
      recipeId: "find-leftover-console",
      force: false,
    });
    expect(err).toContain("not auto_fixable");
  });

  it("allows with force", () => {
    const err = assertApplyAutoFixable({
      recipeId: "find-leftover-console",
      force: true,
    });
    expect(err).toBeUndefined();
  });
});
