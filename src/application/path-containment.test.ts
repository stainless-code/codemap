import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectRelativePathFromResolved } from "./path-containment";

describe("projectRelativePathFromResolved", () => {
  it("rejects sibling paths that only share a string prefix with the root", () => {
    const base = mkdtempSync(join(tmpdir(), "codemap-root-"));
    const root = join(base, "app");
    const outside = join(base, "application", "x.ts");
    expect(projectRelativePathFromResolved(root, outside)).toBeNull();
  });

  it("returns a project-relative path for files inside the root", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-in-"));
    const inside = join(root, "src", "a.ts");
    expect(projectRelativePathFromResolved(root, inside)).toBe("src/a.ts");
  });
});
