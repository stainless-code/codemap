import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canCreateSymlinks } from "../test/symlink-capable";
import {
  pathRealpathEscapesProjectRoot,
  pathTraversesSymlinkOutsideRoot,
  projectRelativePathFromResolved,
  readUtf8WithinProjectRoot,
  rejectUnsafeProjectRelativePath,
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

const symlinkCapable = canCreateSymlinks();

describe("pathTraversesSymlinkOutsideRoot", () => {
  it.skipIf(!symlinkCapable)(
    "returns false for symlinks that stay inside the project root",
    () => {
      const root = mkdtempSync(join(tmpdir(), "codemap-symlink-in-"));
      writeFileSync(join(root, "real.ts"), "export const x = 1;\n");
      symlinkSync(join(root, "real.ts"), join(root, "link.ts"));
      expect(pathTraversesSymlinkOutsideRoot(root, join(root, "link.ts"))).toBe(
        false,
      );
    },
  );

  it.skipIf(!symlinkCapable)(
    "returns true when a path component symlinks outside the project root",
    () => {
      const base = mkdtempSync(join(tmpdir(), "codemap-symlink-out-"));
      const root = join(base, "proj");
      const outside = join(base, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
      symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
      expect(
        pathTraversesSymlinkOutsideRoot(root, join(root, "escape.ts")),
      ).toBe(true);
    },
  );

  it.skipIf(!symlinkCapable)(
    "returns true when an intermediate directory symlinks outside the root",
    () => {
      const base = mkdtempSync(join(tmpdir(), "codemap-symlink-dir-"));
      const root = join(base, "proj");
      const outside = join(base, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(join(outside, "nested"), { recursive: true });
      writeFileSync(
        join(outside, "nested", "secret.ts"),
        "export const s = 1;\n",
      );
      symlinkSync(outside, join(root, "linked-dir"));
      expect(
        pathTraversesSymlinkOutsideRoot(
          root,
          join(root, "linked-dir", "nested", "secret.ts"),
        ),
      ).toBe(true);
    },
  );

  it.skipIf(!symlinkCapable)(
    "returns true for a broken symlink in the path chain",
    () => {
      const root = mkdtempSync(join(tmpdir(), "codemap-symlink-broken-"));
      symlinkSync(join(root, "missing-target.ts"), join(root, "broken.ts"));
      expect(
        pathTraversesSymlinkOutsideRoot(root, join(root, "broken.ts")),
      ).toBe(true);
    },
  );
});

describe("pathRealpathEscapesProjectRoot", () => {
  it.skipIf(!symlinkCapable)(
    "returns true when realpath follows a symlink outside the project root",
    () => {
      const base = mkdtempSync(join(tmpdir(), "codemap-realpath-out-"));
      const root = join(base, "proj");
      const outside = join(base, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
      symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
      expect(
        pathRealpathEscapesProjectRoot(root, join(root, "escape.ts")),
      ).toBe(true);
      expect(rejectUnsafeProjectRelativePath(root, "escape.ts")).toBe(
        "path escapes via symlink",
      );
    },
  );
});

describe("readUtf8WithinProjectRoot", () => {
  it("reads safe files via realpath", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-read-safe-"));
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    const result = readUtf8WithinProjectRoot(root, "a.ts");
    expect(result).toEqual({ ok: true, content: "export const a = 1;\n" });
  });

  it("returns missing for paths that do not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-read-missing-"));
    expect(readUtf8WithinProjectRoot(root, "gone.ts")).toEqual({
      ok: false,
      status: "missing",
    });
  });

  it.skipIf(!symlinkCapable)("rejects broken symlinks before read", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-read-broken-"));
    symlinkSync(join(root, "missing.ts"), join(root, "broken.ts"));
    expect(readUtf8WithinProjectRoot(root, "broken.ts")).toEqual({
      ok: false,
      status: "rejected",
      reason: "path escapes via symlink",
    });
  });

  it.skipIf(!symlinkCapable)("rejects symlink escapes before read", () => {
    const base = mkdtempSync(join(tmpdir(), "codemap-read-escape-"));
    const root = join(base, "proj");
    const outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
    symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
    expect(readUtf8WithinProjectRoot(root, "escape.ts")).toEqual({
      ok: false,
      status: "rejected",
      reason: "path escapes via symlink",
    });
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

  it.skipIf(!symlinkCapable)(
    "returns null when a symlink target resolves outside the root",
    () => {
      const base = mkdtempSync(join(tmpdir(), "codemap-resolve-symlink-"));
      const root = join(base, "proj");
      const outside = join(base, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "secret.ts"), "export const s = 1;\n");
      symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
      expect(resolvePathWithinRoot(root, "escape.ts")).toBeNull();
    },
  );
});
