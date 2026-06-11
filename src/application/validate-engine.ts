import { isAbsolute, relative, sep } from "node:path";

import type { CodemapDatabase } from "../db";
import { hashContent } from "../hash";
import {
  readUtf8WithinProjectRoot,
  rejectUnsafeProjectRelativePath,
} from "./path-containment";

/**
 * One row in the staleness report. `status` distinguishes the cases an
 * agent might want to act on differently.
 */
export interface ValidateRow {
  path: string;
  status: "stale" | "missing" | "unindexed" | "rejected";
  /** Present when `status` is `rejected` (path could not be checked safely). */
  reason?: string;
}

/**
 * Walk the indexed files (or the explicit `paths` set), comparing on-disk
 * SHA-256 to `files.content_hash`. Returns rows that are out of sync. Pure
 * function over an open DB and the project root — covered by unit tests.
 */
export function computeValidateRows(
  db: CodemapDatabase,
  projectRoot: string,
  explicitPaths: string[],
): ValidateRow[] {
  const indexed = db.query("SELECT path, content_hash FROM files").all() as {
    path: string;
    content_hash: string;
  }[];

  const indexByPath = new Map<string, string>();
  for (const row of indexed) indexByPath.set(row.path, row.content_hash);

  const targets =
    explicitPaths.length === 0 ? indexed.map((r) => r.path) : explicitPaths;

  const seen = new Set<string>();
  const rows: ValidateRow[] = [];
  for (const raw of targets) {
    const rel = toProjectRelative(projectRoot, raw);
    if (seen.has(rel)) continue;
    seen.add(rel);

    const rejectReason = rejectUnsafeProjectRelativePath(projectRoot, rel);
    if (rejectReason !== undefined) {
      rows.push({ path: rel, status: "rejected", reason: rejectReason });
      continue;
    }

    const indexedHash = indexByPath.get(rel);
    const readResult = readUtf8WithinProjectRoot(projectRoot, rel);
    if (readResult.ok === false && readResult.status === "rejected") {
      rows.push({
        path: rel,
        status: "rejected",
        reason: readResult.reason,
      });
      continue;
    }
    const source = readResult.ok === true ? readResult.content : undefined;

    if (indexedHash === undefined) {
      if (source !== undefined) rows.push({ path: rel, status: "unindexed" });
      continue;
    }
    if (source === undefined) {
      rows.push({ path: rel, status: "missing" });
      continue;
    }
    if (hashContent(source) !== indexedHash) {
      rows.push({ path: rel, status: "stale" });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

/**
 * Convert a CLI-supplied path to a project-relative POSIX-style key matching
 * the `files.path` format stored in the index. `path.relative()` returns
 * backslash-separated paths on Windows; the index always stores forward
 * slashes (tinyglobby / Bun.Glob / git diff all emit POSIX), so we normalize
 * here to make `indexByPath.get(rel)` succeed cross-platform.
 */
export function toProjectRelative(projectRoot: string, p: string): string {
  const rel = isAbsolute(p) ? relative(projectRoot, p) : p;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
