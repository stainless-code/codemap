import { readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { LANG_MAP } from "./constants";
import { extractCssData } from "./css-parser";
import type {
  FileRow,
  SymbolRow,
  ImportRow,
  ExportRow,
  ComponentRow,
  MarkerRow,
  CssVariableRow,
  CssClassRow,
  CssKeyframeRow,
} from "./db";
import { hashContent } from "./hash";
import { extractMarkers } from "./markers";
import { extractFileData } from "./parser";

const TS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const CSS_EXTENSIONS = new Set([".css"]);

export interface ParsedFile {
  relPath: string;
  error?: boolean;
  parseError?: string;
  fileRow: FileRow;
  category: "ts" | "css" | "text";
  symbols?: SymbolRow[];
  imports?: ImportRow[];
  exports?: ExportRow[];
  components?: ComponentRow[];
  markers?: MarkerRow[];
  cssVariables?: CssVariableRow[];
  cssClasses?: CssClassRow[];
  cssKeyframes?: CssKeyframeRow[];
  cssImportSources?: string[];
}

export interface WorkerInput {
  files: string[];
  projectRoot: string;
}

export interface WorkerOutput {
  results: ParsedFile[];
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
    const category: "ts" | "css" | "text" = TS_EXTENSIONS.has(ext)
      ? "ts"
      : CSS_EXTENSIONS.has(ext)
        ? "css"
        : "text";

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
      category,
    };

    try {
      if (category === "text") {
        parsed.markers = extractMarkers(source, relPath);
      } else if (category === "css") {
        const cssData = extractCssData(absPath, source, relPath);
        parsed.cssVariables = cssData.variables;
        parsed.cssClasses = cssData.classes;
        parsed.cssKeyframes = cssData.keyframes;
        parsed.markers = cssData.markers;
        parsed.cssImportSources = cssData.importSources;
      } else {
        const data = extractFileData(absPath, source, relPath);
        parsed.symbols = data.symbols;
        parsed.imports = data.imports;
        parsed.exports = data.exports;
        parsed.components = data.components;
        parsed.markers = data.markers;
      }
    } catch (err) {
      parsed.parseError = err instanceof Error ? err.message : String(err);
    }

    results.push(parsed);
  }

  return { results };
}
