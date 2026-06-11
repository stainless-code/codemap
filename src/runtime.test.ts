import { beforeEach, describe, expect, it } from "bun:test";

import { resolveCodemapConfig } from "./config";
import { configureResolver } from "./resolver";
import { initCodemap, isPathExcluded } from "./runtime";
import { enterRuntimeSwap, exitRuntimeSwap } from "./runtime-swap";
import { installCodemapTestTeardown } from "./test-helpers/runtime-reset";

installCodemapTestTeardown();

describe("initCodemap root guard", () => {
  it("throws when switching to a different root without runtime swap", () => {
    initCodemap(resolveCodemapConfig("/root-a", {}));
    expect(() => initCodemap(resolveCodemapConfig("/root-b", {}))).toThrow(
      /cannot switch project root/,
    );
  });

  it("allows re-init on the same root", () => {
    initCodemap(resolveCodemapConfig("/same-root", { excludeDirNames: ["x"] }));
    expect(() =>
      initCodemap(resolveCodemapConfig("/same-root", {})),
    ).not.toThrow();
  });

  it("allows root switch inside audit runtime swap bracket", () => {
    initCodemap(resolveCodemapConfig("/live-root", {}));
    enterRuntimeSwap();
    try {
      expect(() =>
        initCodemap(resolveCodemapConfig("/worktree-root", {})),
      ).not.toThrow();
      initCodemap(resolveCodemapConfig("/live-root", {}));
    } finally {
      exitRuntimeSwap();
    }
    expect(() => initCodemap(resolveCodemapConfig("/other-root", {}))).toThrow(
      /cannot switch project root/,
    );
  });
});

describe("configureResolver root guard", () => {
  it("throws when switching to a different root without runtime swap", () => {
    configureResolver("/resolver-a", null);
    expect(() => configureResolver("/resolver-b", null)).toThrow(
      /cannot switch resolver root/,
    );
  });
});

describe("isPathExcluded", () => {
  beforeEach(() => {
    initCodemap(
      resolveCodemapConfig("/virtual-root", {
        excludeDirNames: ["node_modules", ".git", "dist"],
      }),
    );
  });

  it("excludes paths under node_modules", () => {
    expect(isPathExcluded("node_modules/foo.ts")).toBe(true);
  });

  it("excludes nested node_modules segment", () => {
    expect(isPathExcluded("packages/a/node_modules/pkg/x.ts")).toBe(true);
  });

  it("excludes .git segment", () => {
    expect(isPathExcluded(".git/objects/foo")).toBe(true);
  });

  it("does not exclude normal source paths", () => {
    expect(isPathExcluded("src/foo.ts")).toBe(false);
    expect(isPathExcluded("src/node.ts")).toBe(false);
  });

  it("handles Windows-style separators", () => {
    expect(isPathExcluded("src\\node_modules\\x.ts")).toBe(true);
  });
});
