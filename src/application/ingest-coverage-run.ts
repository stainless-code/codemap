import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { CodemapDatabase } from "../sqlite-db";
import { ingestIstanbul, ingestLcov, ingestV8 } from "./coverage-engine";
import type {
  CoverageFormat,
  IngestResult,
  IstanbulPayload,
  V8CoveragePayload,
  V8ScriptCoverage,
} from "./coverage-engine";

const ISTANBUL_FILENAME = "coverage-final.json";
const LCOV_FILENAME = "lcov.info";
const V8_FILENAME_RE = /^coverage-.*\.json$/;

export interface IngestCoverageRunOpts {
  projectRoot: string;
  /** User path (relative to projectRoot or absolute). */
  path: string;
  runtime?: boolean;
}

export interface IngestCoverageRunOk {
  ok: true;
  result: IngestResult;
  sourcePath: string;
}

export interface IngestCoverageRunError {
  ok: false;
  error: string;
}

/**
 * Resolve the user-supplied path to a concrete (artifact, format) pair.
 * Directory inputs probe for `coverage-final.json` and `lcov.info`;
 * presence of both is an explicit error (no precedence guessing).
 */
export function resolveCoverageArtifact(
  inputPath: string,
  cwd: string,
): { format: CoverageFormat; absPath: string } {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
  if (!existsSync(abs)) {
    throw new Error(`codemap ingest-coverage: path not found: ${abs}`);
  }
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    const istanbul = join(abs, ISTANBUL_FILENAME);
    const lcov = join(abs, LCOV_FILENAME);
    const hasIstanbul = existsSync(istanbul);
    const hasLcov = existsSync(lcov);
    if (hasIstanbul && hasLcov) {
      throw new Error(
        `codemap ingest-coverage: directory ${abs} contains both ${ISTANBUL_FILENAME} and ${LCOV_FILENAME}. Pass the file path explicitly.`,
      );
    }
    if (hasIstanbul) return { format: "istanbul", absPath: istanbul };
    if (hasLcov) return { format: "lcov", absPath: lcov };
    throw new Error(
      `codemap ingest-coverage: directory ${abs} contains neither ${ISTANBUL_FILENAME} nor ${LCOV_FILENAME}.`,
    );
  }
  if (abs.endsWith(".json")) return { format: "istanbul", absPath: abs };
  if (abs.endsWith(".info")) return { format: "lcov", absPath: abs };
  throw new Error(
    `codemap ingest-coverage: cannot auto-detect format from "${abs}". Expected a .json (Istanbul) or .info (LCOV) file, or a directory containing one.`,
  );
}

export function resolveV8CoverageDirectory(
  inputPath: string,
  cwd: string,
): { absDir: string; jsonFiles: string[] } {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
  if (!existsSync(abs)) {
    throw new Error(`codemap ingest-coverage: path not found: ${abs}`);
  }
  const stat = statSync(abs);
  if (!stat.isDirectory()) {
    throw new Error(
      `codemap ingest-coverage --runtime: expected a directory (NODE_V8_COVERAGE-style), got file ${abs}`,
    );
  }
  const jsonFiles = readdirSync(abs)
    .filter((f) => V8_FILENAME_RE.test(f))
    .map((f) => join(abs, f));
  if (jsonFiles.length === 0) {
    throw new Error(
      `codemap ingest-coverage --runtime: directory ${abs} contains no coverage-*.json files. NODE_V8_COVERAGE writes coverage-<pid>-<ts>-<seq>.json — point --runtime at the directory the test runner wrote to.`,
    );
  }
  return { absDir: abs, jsonFiles };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  if (typeof Bun !== "undefined") {
    return Bun.file(filePath).json();
  }
  const text = await readFile(filePath, "utf-8");
  return JSON.parse(text) as unknown;
}

async function readTextFile(filePath: string): Promise<string> {
  if (typeof Bun !== "undefined") {
    return Bun.file(filePath).text();
  }
  return readFile(filePath, "utf-8");
}

/** Transport-agnostic ingest — caller owns `openDb` / bootstrap. */
export async function runIngestCoverageOnDb(
  db: CodemapDatabase,
  opts: IngestCoverageRunOpts,
): Promise<IngestCoverageRunOk | IngestCoverageRunError> {
  try {
    let result: IngestResult;
    let sourcePath: string;
    if (opts.runtime) {
      const { absDir, jsonFiles } = resolveV8CoverageDirectory(
        opts.path,
        opts.projectRoot,
      );
      sourcePath = absDir;
      const scripts: V8ScriptCoverage[] = [];
      for (const file of jsonFiles) {
        const payload = (await readJsonFile(file)) as V8CoveragePayload;
        if (Array.isArray(payload?.result)) scripts.push(...payload.result);
      }
      if (scripts.length === 0) {
        return {
          ok: false,
          error: `codemap ingest-coverage --runtime: ${jsonFiles.length} coverage-*.json file(s) under ${absDir} contained no V8 \`result\` arrays. Confirm the directory is the one NODE_V8_COVERAGE wrote to.`,
        };
      }
      result = ingestV8({
        db,
        projectRoot: opts.projectRoot,
        scripts,
        sourcePath: absDir,
      });
    } else {
      const { format, absPath } = resolveCoverageArtifact(
        opts.path,
        opts.projectRoot,
      );
      sourcePath = absPath;
      if (format === "istanbul") {
        const payload = (await readJsonFile(absPath)) as IstanbulPayload;
        result = ingestIstanbul({
          db,
          projectRoot: opts.projectRoot,
          payload,
          sourcePath: absPath,
        });
      } else {
        const payload = await readTextFile(absPath);
        result = ingestLcov({
          db,
          projectRoot: opts.projectRoot,
          payload,
          sourcePath: absPath,
        });
      }
    }
    return { ok: true, result, sourcePath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
