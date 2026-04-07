import { readFileSync } from "node:fs";
import { join } from "node:path";

import { globSync } from "./glob-sync";
import { getProjectRoot, isPathExcluded } from "./runtime";

export function globFiles(patterns: string[], cwd: string): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const p of globSync(pattern, cwd)) {
      files.add(p);
    }
  }
  return [...files];
}

export function globFilesFiltered(patterns: string[], cwd: string): string[] {
  return globFiles(patterns, cwd).filter((p) => !isPathExcluded(p));
}

export function readAll(
  paths: string[],
  cwd: string,
): { totalBytes: number; contents: Map<string, string> } {
  let totalBytes = 0;
  const contents = new Map<string, string>();
  for (const p of paths) {
    try {
      const content = readFileSync(join(cwd, p), "utf-8");
      totalBytes += Buffer.byteLength(content);
      contents.set(p, content);
    } catch {}
  }
  return { totalBytes, contents };
}

export function traditionalFanoutImportLines(): {
  results: unknown[];
  filesRead: number;
  bytesRead: number;
} {
  const cwd = getProjectRoot();
  const files = globFilesFiltered(["**/*.{ts,tsx,js,jsx}"], cwd);
  const { totalBytes, contents } = readAll(files, cwd);
  const importish = /^\s*(?:import\b|export\s+[^;]*\bfrom\b|require\s*\()/;
  const counts = new Map<string, number>();
  for (const [path, content] of contents) {
    let n = 0;
    for (const line of content.split("\n")) {
      if (importish.test(line)) n++;
    }
    counts.set(path, n);
  }
  const results = [...counts.entries()]
    .filter(([, deps]) => deps > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([from_path, deps]) => ({ from_path, deps }));
  return { results, filesRead: files.length, bytesRead: totalBytes };
}
