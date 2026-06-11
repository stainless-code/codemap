import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  pathTraversesSymlinkOutsideRoot,
  projectRelativePathFromResolved,
  resolvePathWithinRoot,
} from "./path-containment";

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

describe("pathTraversesSymlinkOutsideRoot", () => {
  it("returns false for symlinks that stay inside the project root", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-symlink-in-"));
    writeFileSync(join(root, "real.ts"), "export const x = 1;\n");
    symlinkSync(join(root, "real.ts"), join(root, "link.ts"));
    expect(pathTraversesSymlinkOutsideRoot(root, join(root, "link.ts"))).toBe(
      false,
    );
  });

  it("returns true when a path component symlinks outside the project root", () => {
    const base = mkdtempSync(join(tmpdir(), "codemap-symlink-out-"));
    const root = join(base, "proj");
    const outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
    symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
    expect(pathTraversesSymlinkOutsideRoot(root, join(root, "escape.ts"))).toBe(
      true,
    );
  });
});

describe("resolvePathWithinRoot", () => {
  it("returns the resolved absolute path for safe relative paths", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-resolve-"));
    mkdirSync(join(root, "src"), { recursive: true });
    expect(resolvePathWithinRoot(root, "src/a.ts")).toBe(
      join(root, "src", "a.ts"),
    );
  });

  it("returns null when a relative path escapes via ..", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-resolve-escape-"));
    expect(resolvePathWithinRoot(root, "../../../etc/passwd")).toBeNull();
  });

  it("returns null when a symlink target resolves outside the root", () => {
    const base = mkdtempSync(join(tmpdir(), "codemap-resolve-symlink-"));
    const root = join(base, "proj");
    const outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
    symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
    expect(resolvePathWithinRoot(root, "escape.ts")).toBeNull();
  });
});
