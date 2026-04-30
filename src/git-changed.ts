import { spawnSync } from "node:child_process";

/**
 * Files changed between `ref` and the working tree — union of:
 * - `git diff --name-only <ref>...HEAD` (committed deltas since the merge base)
 * - `git status --porcelain --no-renames` (staged + unstaged changes not in the diff)
 *
 * Paths are returned **project-relative, POSIX-style** (matching how `files.path`
 * is stored in the index). The `ref` can be any committish (`origin/main`,
 * `HEAD~5`, `<sha>`, a tag, …).
 *
 * Returns an `{ error }` object — never throws — so the caller can surface a
 * clean CLI message instead of a stack trace.
 */
export function getFilesChangedSince(
  ref: string,
  root: string,
): { ok: true; files: Set<string> } | { ok: false; error: string } {
  if (!ref || ref.trim() === "") {
    return { ok: false, error: "--changed-since requires a non-empty ref" };
  }

  const verify = spawnSync(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    {
      cwd: root,
    },
  );
  if (verify.status !== 0) {
    const stderr = verify.stderr.toString().trim();
    return {
      ok: false,
      error: `--changed-since: cannot resolve "${ref}" to a commit${stderr ? ` (${stderr})` : ""}`,
    };
  }

  const diff = spawnSync("git", ["diff", "--name-only", `${ref}...HEAD`], {
    cwd: root,
  });
  if (diff.status !== 0) {
    const stderr = diff.stderr.toString().trim();
    return {
      ok: false,
      error: `--changed-since: git diff failed${stderr ? ` (${stderr})` : ""}`,
    };
  }

  const status = spawnSync("git", ["status", "--porcelain", "--no-renames"], {
    cwd: root,
  });

  const diffFiles = diff.stdout.toString().trim().split("\n").filter(Boolean);
  // Porcelain rows are `XY path` (two status chars + space); slice past the prefix.
  const statusFiles = status.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  return { ok: true, files: new Set([...diffFiles, ...statusFiles]) };
}

/**
 * Column names on indexed rows that hold a project-relative POSIX file path.
 * Order doesn't matter — a row is kept if any one of these columns matches a
 * member of the changed-file set.
 */
export const PATH_COLUMNS = [
  "path",
  "file_path",
  "from_path",
  "to_path",
  "resolved_path",
] as const;

/**
 * Filter `rows` to those touching at least one file in `changed`. Rows that
 * carry none of the recognised path columns are passed through unchanged
 * (the filter cannot decide, so it does not hide them — `--summary` on top
 * gives a row count when that ambiguity matters).
 */
export function filterRowsByChangedFiles(
  rows: unknown[],
  changed: Set<string>,
): unknown[] {
  return rows.filter((row) => {
    if (typeof row !== "object" || row === null) return true;
    const obj = row as Record<string, unknown>;
    let sawPathColumn = false;
    for (const col of PATH_COLUMNS) {
      const v = obj[col];
      if (typeof v === "string") {
        sawPathColumn = true;
        if (changed.has(v)) return true;
      }
    }
    return !sawPathColumn;
  });
}
