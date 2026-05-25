import {
  globFilesFiltered,
  readAll,
  traditionalFanoutImportLines,
} from "../../src/benchmark-common";
import { collectGlobalRegexMatches } from "../../src/benchmark-config";
import { getProjectRoot } from "../../src/runtime";
import type { TraditionalSpec } from "./schema";

export interface TraditionalProbeResult {
  results: unknown[];
  filesRead: number;
  bytesRead: number;
  wallMs: number;
}

export function runTraditionalProbe(
  spec: TraditionalSpec,
): TraditionalProbeResult {
  const t0 = performance.now();
  const raw =
    "builtin" in spec
      ? traditionalFanoutImportLines()
      : runRegexTraditional(spec);
  return { ...raw, wallMs: performance.now() - t0 };
}

function runRegexTraditional(spec: {
  globs: string[];
  regex: string;
  mode: "files" | "matches";
}): Omit<TraditionalProbeResult, "wallMs"> {
  const cwd = getProjectRoot();
  const files = globFilesFiltered(spec.globs, cwd);
  const { totalBytes, contents } = readAll(files, cwd);
  const results: unknown[] = [];
  if (spec.mode === "matches") {
    for (const [path, content] of contents) {
      for (const match of collectGlobalRegexMatches(content, spec.regex)) {
        results.push({ file_path: path, match });
      }
    }
  } else {
    for (const [path, content] of contents) {
      if (new RegExp(spec.regex).test(content))
        results.push({ file_path: path });
    }
  }
  return { results, filesRead: files.length, bytesRead: totalBytes };
}

/** Agent-discovery tool sequence for glob → read → grep (no MCP). */
export function traditionalToolSequence(filesRead: number): string[] {
  const seq: string[] = ["glob"];
  for (let i = 0; i < filesRead; i++) seq.push("read");
  seq.push("grep");
  return seq;
}
