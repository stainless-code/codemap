import { lstatSync, readFileSync, realpathSync } from "node:fs";
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
        try {
          const linkReal = realpathSync(current);
          if (!isWithinProjectRoot(rootReal, linkReal)) return true;
          current = linkReal;
        } catch {
          // Broken symlink — cannot verify containment.
          return true;
        }
      }
    } catch {
      // Missing tail — string containment already checked.
      return false;
    }
  }
  return false;
}

/**
 * `true` when `realpathSync(absPath)` resolves outside `projectRoot` (symlink
 * targets or TOCTOU swaps). `false` when the path is missing. Hardlinks to
 * outside files keep an in-root pathname — not detectable via `realpath` alone
 * (local-trust boundary; same class as apply reads).
 */
export function pathRealpathEscapesProjectRoot(
  projectRoot: string,
  absPath: string,
): boolean {
  const resolvedRoot = resolve(projectRoot);
  let rootReal: string;
  try {
    rootReal = realpathSync(resolvedRoot);
  } catch {
    rootReal = resolvedRoot;
  }
  try {
    const targetReal = realpathSync(absPath);
    return !isWithinProjectRoot(rootReal, targetReal);
  } catch {
    return false;
  }
}

export type UnsafeProjectPathReason =
  | "path escapes project root"
  | "path escapes via symlink"
  | "path resolves outside project root";

/** Containment checks shared by validate reads and `resolvePathWithinRoot`. */
export function rejectUnsafeProjectRelativePath(
  projectRoot: string,
  relativePath: string,
): UnsafeProjectPathReason | undefined {
  if (pathEscapesProjectRoot(projectRoot, relativePath)) {
    return "path escapes project root";
  }
  const abs = resolve(projectRoot, relativePath);
  if (pathTraversesSymlinkOutsideRoot(projectRoot, abs)) {
    return "path escapes via symlink";
  }
  if (pathRealpathEscapesProjectRoot(projectRoot, abs)) {
    return "path resolves outside project root";
  }
  return undefined;
}

export type SafeProjectReadResult =
  | { ok: true; content: string }
  | { ok: false; status: "missing" }
  | { ok: false; status: "rejected"; reason: UnsafeProjectPathReason };

/** Read UTF-8 text after realpath containment (re-check immediately before read). */
export function readUtf8WithinProjectRoot(
  projectRoot: string,
  relativePath: string,
): SafeProjectReadResult {
  const rejectReason = rejectUnsafeProjectRelativePath(
    projectRoot,
    relativePath,
  );
  if (rejectReason !== undefined) {
    return { ok: false, status: "rejected", reason: rejectReason };
  }

  const resolvedRoot = resolve(projectRoot);
  let rootReal: string;
  try {
    rootReal = realpathSync(resolvedRoot);
  } catch {
    rootReal = resolvedRoot;
  }

  let targetReal: string;
  try {
    targetReal = realpathSync(resolve(projectRoot, relativePath));
  } catch {
    return { ok: false, status: "missing" };
  }

  if (!isWithinProjectRoot(rootReal, targetReal)) {
    return {
      ok: false,
      status: "rejected",
      reason: "path resolves outside project root",
    };
  }

  try {
    return { ok: true, content: readFileSync(targetReal, "utf8") };
  } catch {
    return { ok: false, status: "missing" };
  }
}

/** Resolve `relativePath` under `root`; `null` when it escapes the root. */
export function resolvePathWithinRoot(
  root: string,
  relativePath: string,
): string | null {
  if (rejectUnsafeProjectRelativePath(root, relativePath) !== undefined) {
    return null;
  }
  return resolve(root, relativePath);
}
