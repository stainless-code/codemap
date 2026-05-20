import { isAbsolute, resolve, sep } from "node:path";

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
