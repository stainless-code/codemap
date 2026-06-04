import type { ApplyInputRow } from "./apply-engine";

/**
 * Hand-rolled unified-diff → apply row contract (single-line `-`/`+` pairs per hunk).
 * Multi-line hunks emit one row per paired line; unpaired `+`/`-` lines are skipped.
 */
export function parseUnifiedDiffToRows(diffText: string): ApplyInputRow[] {
  const rows: ApplyInputRow[] = [];
  let currentFile: string | undefined;
  let newLine = 0;
  const pendingMinus: { file_path: string; before_pattern: string }[] = [];

  const flushPair = (plus: {
    file_path: string;
    line_start: number;
    after_pattern: string;
  }): void => {
    const minus = pendingMinus.shift();
    if (minus === undefined) return;
    if (minus.file_path !== plus.file_path) return;
    if (minus.before_pattern.length === 0) return;
    rows.push({
      file_path: plus.file_path,
      line_start: plus.line_start,
      before_pattern: minus.before_pattern,
      after_pattern: plus.after_pattern,
    });
  };

  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      const path = parseDiffPath(rawLine.slice(4).trim());
      if (path !== undefined) currentFile = path;
      pendingMinus.length = 0;
      continue;
    }
    if (rawLine.startsWith("--- ") || rawLine.startsWith("diff ")) continue;

    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      newLine = Number.parseInt(hunk[1]!, 10);
      pendingMinus.length = 0;
      continue;
    }

    if (currentFile === undefined) continue;
    if (rawLine.startsWith("\\")) continue;

    if (rawLine.startsWith(" ")) {
      pendingMinus.length = 0;
      newLine++;
      continue;
    }
    if (rawLine.startsWith("-")) {
      pendingMinus.push({
        file_path: currentFile,
        before_pattern: rawLine.slice(1),
      });
      continue;
    }
    if (rawLine.startsWith("+")) {
      flushPair({
        file_path: currentFile,
        line_start: newLine,
        after_pattern: rawLine.slice(1),
      });
      newLine++;
      continue;
    }
  }

  return rows;
}

function parseDiffPath(header: string): string | undefined {
  let path = header;
  if (path.startsWith("b/")) path = path.slice(2);
  if (path === "/dev/null") return undefined;
  return path;
}
