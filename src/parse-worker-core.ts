import { readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { getAdapterForExtension } from "./adapters/builtin";
import type { ParseContext } from "./adapters/types";
import { LANG_MAP } from "./constants";
import type { FileRow } from "./db";
import { hashContent } from "./hash";
import { extractMarkers } from "./markers";
import type { ParsedFile } from "./parsed-types";

export type { ParsedFile } from "./parsed-types";

export interface WorkerInput {
  files: string[];
  projectRoot: string;
}

export interface WorkerOutput {
  results: ParsedFile[];
}

function parseAsTextFallback(
  source: string,
  relPath: string,
): Pick<ParsedFile, "category" | "markers"> {
  return {
    category: "text",
    markers: extractMarkers(source, relPath),
  };
}

export function parseWorkerInput(input: WorkerInput): WorkerOutput {
  const { files, projectRoot } = input;
  const results: ParsedFile[] = [];

  for (const relPath of files) {
    const absPath = join(projectRoot, relPath);
    let source: string;
    try {
      source = readFileSync(absPath, "utf-8");
    } catch {
      results.push({
        relPath,
        error: true,
        fileRow: {} as FileRow,
        category: "text",
      });
      continue;
    }

    const hash = hashContent(source);
    const stat = statSync(absPath);
    let lineCount = 1;
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) lineCount++;
    }

    const ext = extname(relPath);
    const language = LANG_MAP[ext] ?? "text";

    const parsed: ParsedFile = {
      relPath,
      fileRow: {
        path: relPath,
        content_hash: hash,
        size: stat.size,
        line_count: lineCount,
        language,
        last_modified: Math.floor(stat.mtimeMs),
        indexed_at: Date.now(),
      },
      category: "text",
    };

    const ctx: ParseContext = { absPath, relPath, source };

    const parseStart = performance.now();
    try {
      const adapter = getAdapterForExtension(ext);
      const payload = adapter
        ? adapter.parse(ctx)
        : parseAsTextFallback(source, relPath);
      Object.assign(parsed, payload);
    } catch (err) {
      parsed.parseError = err instanceof Error ? err.message : String(err);
    }
    parsed.parseMs = performance.now() - parseStart;

    results.push(parsed);
  }

  return { results };
}
