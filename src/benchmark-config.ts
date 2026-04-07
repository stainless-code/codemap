import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  globFilesFiltered,
  readAll,
  traditionalFanoutImportLines,
} from "./benchmark-common";
import type { Scenario } from "./benchmark-default-scenarios";
import type { CodemapDatabase } from "./db";
import { getProjectRoot } from "./runtime";

interface TraditionalRegexSpec {
  globs: string[];
  /** JavaScript regex body (not wrapped in slashes). Use \\\\ for backslashes in JSON. */
  regex: string;
  /** `files` = one result per file with ≥1 match; `matches` = every global match (like TODO scan). */
  mode: "files" | "matches";
}

interface TraditionalBuiltinSpec {
  builtin: "fanoutImportLines";
}

type TraditionalSpec = TraditionalRegexSpec | TraditionalBuiltinSpec;

interface ConfigScenario {
  name: string;
  indexedSql: string;
  traditional: TraditionalSpec;
}

interface BenchmarkConfigFile {
  /** If true (default), drop built-in demo scenarios and use only this list. */
  replaceDefault?: boolean;
  scenarios: ConfigScenario[];
}

function isBuiltin(t: TraditionalSpec): t is TraditionalBuiltinSpec {
  return "builtin" in t && t.builtin === "fanoutImportLines";
}

function traditionalFromSpec(spec: TraditionalSpec): () => {
  results: unknown[];
  filesRead: number;
  bytesRead: number;
} {
  if (isBuiltin(spec)) {
    return traditionalFanoutImportLines;
  }
  const { globs, regex, mode } = spec;
  if (!globs?.length || !regex) {
    throw new Error(
      "traditional: need globs + regex, or builtin fanoutImportLines",
    );
  }
  return () => {
    const cwd = getProjectRoot();
    const files = globFilesFiltered(globs, cwd);
    const { totalBytes, contents } = readAll(files, cwd);
    const results: unknown[] = [];
    if (mode === "matches") {
      const re = new RegExp(regex, "g");
      for (const [path, content] of contents) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push({ file_path: path, match: m[0] });
        }
      }
    } else {
      for (const [path, content] of contents) {
        if (new RegExp(regex).test(content)) results.push({ file_path: path });
      }
    }
    return { results, filesRead: files.length, bytesRead: totalBytes };
  };
}

function parseConfigJson(raw: string): BenchmarkConfigFile {
  const data: unknown = JSON.parse(raw);
  if (data === null || typeof data !== "object") {
    throw new Error("benchmark config: expected object");
  }
  const o = data as Record<string, unknown>;
  const scenarios = o.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("benchmark config: scenarios must be a non-empty array");
  }
  for (const s of scenarios) {
    if (s === null || typeof s !== "object") {
      throw new Error("benchmark config: invalid scenario entry");
    }
    const e = s as Record<string, unknown>;
    if (typeof e.name !== "string" || e.name.length === 0) {
      throw new Error("benchmark config: each scenario needs a name");
    }
    if (typeof e.indexedSql !== "string" || e.indexedSql.trim() === "") {
      throw new Error(`benchmark config: ${e.name}: indexedSql required`);
    }
    if (e.traditional === null || typeof e.traditional !== "object") {
      throw new Error(`benchmark config: ${e.name}: traditional required`);
    }
    const t = e.traditional as Record<string, unknown>;
    if (t.builtin === "fanoutImportLines") continue;
    if (!Array.isArray(t.globs) || t.globs.some((g) => typeof g !== "string")) {
      throw new Error(
        `benchmark config: ${e.name}: traditional.globs must be string[]`,
      );
    }
    if (typeof t.regex !== "string") {
      throw new Error(
        `benchmark config: ${e.name}: traditional.regex required`,
      );
    }
    if (t.mode !== "files" && t.mode !== "matches") {
      throw new Error(
        `benchmark config: ${e.name}: traditional.mode must be "files" or "matches"`,
      );
    }
  }
  return {
    replaceDefault: o.replaceDefault !== false,
    scenarios: scenarios as ConfigScenario[],
  };
}

/**
 * Load scenarios from a JSON file (CODEMAP_BENCHMARK_CONFIG).
 * Paths are resolved from cwd first, then relative to this module's directory is not used — use absolute or cwd-relative.
 */
export function loadScenariosFromConfigFile(
  db: CodemapDatabase,
  configPath: string,
): { replaceDefault: boolean; scenarios: Scenario[] } {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    throw new Error(`CODEMAP_BENCHMARK_CONFIG: file not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, "utf-8");
  const config = parseConfigJson(raw);
  const scenarios: Scenario[] = config.scenarios.map((s) => ({
    name: s.name,
    indexed: () => db.query(s.indexedSql).all(),
    traditional: traditionalFromSpec(s.traditional),
  }));
  return {
    replaceDefault: config.replaceDefault !== false,
    scenarios,
  };
}
