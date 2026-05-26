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
  regex: string;
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
  /** Always normalized in {@link parseConfigJson} (default **true**). */
  replaceDefault: boolean;
  scenarios: ConfigScenario[];
}

/**
 * Reject mutating or multi-statement SQL. Benchmark JSON is local/trusted but must not run DDL/DML against the codemap index.
 */
export function assertReadOnlyIndexedSql(sql: string): void {
  const trimmed = sql.trim();
  if (trimmed === "") throw new Error("indexedSql must be non-empty");
  const oneStmt = trimmed.replace(/;\s*$/u, "").trim();
  if (oneStmt.includes(";")) {
    throw new Error("indexedSql must be a single statement");
  }
  if (
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|ATTACH|DETACH|VACUUM|PRAGMA|TRUNCATE|REINDEX|ANALYZE)\b/i.test(
      oneStmt,
    )
  ) {
    throw new Error(
      "indexedSql must be read-only (no DDL/DML or PRAGMA keywords)",
    );
  }
  if (/\bRETURNING\b/i.test(oneStmt)) {
    throw new Error("indexedSql must not use RETURNING");
  }
  if (!/^\s*(?:WITH\b|SELECT\b)/iu.test(oneStmt)) {
    throw new Error(
      "indexedSql must be a single SELECT (optionally WITH … SELECT)",
    );
  }
}

function isBuiltin(t: TraditionalSpec): t is TraditionalBuiltinSpec {
  return "builtin" in t && t.builtin === "fanoutImportLines";
}

/**
 * All global matches for `regex` in `content`. Advances `lastIndex` after zero-length
 * hits so patterns like `(a|)` cannot stall the benchmark runner.
 */
export function collectGlobalRegexMatches(
  content: string,
  regex: string,
): string[] {
  const re = new RegExp(regex, "g");
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    matches.push(m[0]);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return matches;
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
    const { totalBytes, contents, unreadable } = readAll(files, cwd);
    if (unreadable.length > 0) {
      console.error(
        `[benchmark] skipped ${unreadable.length} unreadable file(s): ${unreadable.slice(0, 3).join(", ")}${unreadable.length > 3 ? "…" : ""}`,
      );
    }
    const results: unknown[] = [];
    if (mode === "matches") {
      for (const [path, content] of contents) {
        for (const match of collectGlobalRegexMatches(content, regex)) {
          results.push({ file_path: path, match });
        }
      }
    } else {
      // `regex` comes from developer-controlled benchmark JSON (trusted input).
      const re = new RegExp(regex);
      for (const [path, content] of contents) {
        if (re.test(content)) results.push({ file_path: path });
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
    try {
      assertReadOnlyIndexedSql(e.indexedSql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`benchmark config: ${e.name}: ${msg}`);
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
    try {
      new RegExp(t.regex as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `benchmark config: ${e.name}: traditional.regex is not a valid regex: ${msg}`,
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
 * Load scenarios from a JSON file (**`CODEMAP_BENCHMARK_CONFIG`**).
 * The path is resolved from **`process.cwd()`** via **`resolve(configPath)`** (not relative to this module); use an absolute path or a path relative to the shell cwd.
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
    replaceDefault: config.replaceDefault,
    scenarios,
  };
}
