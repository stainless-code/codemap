import { describe, expect, it, beforeAll } from "bun:test";

import { resolveCodemapConfig } from "./config";
import { initCodemap, isPathExcluded } from "./runtime";

describe("isPathExcluded", () => {
  beforeAll(() => {
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
