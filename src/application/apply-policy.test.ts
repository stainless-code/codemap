import { describe, expect, it } from "bun:test";

import { assertApplyAllowlist, assertApplyAutoFixable } from "./apply-policy";

describe("assertApplyAutoFixable", () => {
  it("allows rename-preview without force when auto_fixable", () => {
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

describe("assertApplyAllowlist", () => {
  it("skips when allowlist is unset", () => {
    expect(
      assertApplyAllowlist({
        recipeId: "rename-preview",
        yes: true,
        force: false,
        allowlist: undefined,
      }),
    ).toBeUndefined();
  });

  it("skips when allowlist is empty", () => {
    expect(
      assertApplyAllowlist({
        recipeId: "rename-preview",
        yes: true,
        force: false,
        allowlist: [],
      }),
    ).toBeUndefined();
  });

  it("allows listed recipe with --yes", () => {
    expect(
      assertApplyAllowlist({
        recipeId: "migrate-import-source",
        yes: true,
        force: false,
        allowlist: ["migrate-import-source", "rename-preview"],
      }),
    ).toBeUndefined();
  });

  it("blocks unlisted recipe with --yes", () => {
    const err = assertApplyAllowlist({
      recipeId: "rename-preview",
      yes: true,
      force: false,
      allowlist: ["migrate-import-source"],
    });
    expect(err).toContain("apply.autoApplyRecipes");
  });

  it("bypasses allowlist with --force", () => {
    expect(
      assertApplyAllowlist({
        recipeId: "rename-preview",
        yes: true,
        force: true,
        allowlist: ["migrate-import-source"],
      }),
    ).toBeUndefined();
  });

  it("skips allowlist without --yes", () => {
    expect(
      assertApplyAllowlist({
        recipeId: "rename-preview",
        yes: false,
        force: false,
        allowlist: ["migrate-import-source"],
      }),
    ).toBeUndefined();
  });
});
