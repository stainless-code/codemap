import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** `true` iff `resolve(resolvedRoot, candidate)` lands inside `resolvedRoot`. */
export function isWithinProjectRoot(
  resolvedRoot: string,
  candidate: string,
): boolean {
  const resolved = resolve(resolvedRoot, candidate);
  if (resolved === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolved.startsWith(prefix);
}

/**
 * Canonical project-relative form. Caller must have verified
 * {@link isWithinProjectRoot} first.
 */
export function canonicalizeProjectFilePath(
  resolvedRoot: string,
  candidate: string,
): string {
  const absolute = resolve(resolvedRoot, candidate);
  if (absolute === resolvedRoot) return "";
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return absolute.slice(prefix.length);
}

/** Reject absolute paths and `..` traversal relative to `projectRoot`. */
export function pathEscapesProjectRoot(
  projectRoot: string,
  filePath: string,
): boolean {
  const resolvedRoot = resolve(projectRoot);
  return isAbsolute(filePath) || !isWithinProjectRoot(resolvedRoot, filePath);
}

/**
 * Map an absolute resolved path to a project-relative path, or `null` when the
 * target is outside the root (rejects string-prefix siblings like
 * `/repo/app` vs `/repo/application`).
 */
export function projectRelativePathFromResolved(
  projectRoot: string,
  resolvedAbsolute: string,
): string | null {
  const resolvedRoot = resolve(projectRoot);
  const abs = resolve(resolvedAbsolute);
  if (!isWithinProjectRoot(resolvedRoot, abs)) return null;
  return canonicalizeProjectFilePath(resolvedRoot, abs);
}

/**
 * `true` when any path component under `projectRoot` is a symlink whose target
 * resolves outside the project root (apply/diff/validate follow symlinks on read).
 */
export function pathTraversesSymlinkOutsideRoot(
  projectRoot: string,
  absPath: string,
): boolean {
  const resolvedRoot = resolve(projectRoot);
  const resolvedTarget = resolve(absPath);
  if (!isWithinProjectRoot(resolvedRoot, resolvedTarget)) return true;

  let rootReal: string;
  try {
    rootReal = realpathSync(resolvedRoot);
  } catch {
    rootReal = resolvedRoot;
  }

  let current = resolvedRoot;
  const relParts = relative(resolvedRoot, resolvedTarget)
    .split(sep)
    .filter(Boolean);
  for (const part of relParts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        const linkReal = realpathSync(current);
        if (!isWithinProjectRoot(rootReal, linkReal)) return true;
        current = linkReal;
      }
    } catch {
      // Missing tail — string containment already checked.
      return false;
    }
  }
  return false;
}

/** Resolve `relativePath` under `root`; `null` when it escapes the root. */
export function resolvePathWithinRoot(
  root: string,
  relativePath: string,
): string | null {
  if (pathEscapesProjectRoot(root, relativePath)) return null;
  const abs = resolve(root, relativePath);
  if (pathTraversesSymlinkOutsideRoot(root, abs)) return null;
  return abs;
}
