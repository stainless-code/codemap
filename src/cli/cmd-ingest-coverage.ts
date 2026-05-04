import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { ingestIstanbul, ingestLcov } from "../application/coverage-engine";
import type {
  CoverageFormat,
  IngestResult,
  IstanbulPayload,
} from "../application/coverage-engine";
import { closeDb, openDb } from "../db";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface IngestCoverageOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  /** Resolved absolute path to coverage-final.json, lcov.info, or a directory. */
  path: string;
  json: boolean;
}

const ISTANBUL_FILENAME = "coverage-final.json";
const LCOV_FILENAME = "lcov.info";

export function printIngestCoverageCmdHelp(): void {
  console.log(`Usage: codemap ingest-coverage <path> [--json]

Ingest a static coverage artifact into the index so structural queries
can compose coverage filters in pure SQL. No test runner is invoked —
codemap reads what \`bun test\`, \`vitest\`, \`jest\`, \`c8\`, \`nyc\`
already produce.

Args:
  <path>          Path to one of:
                    - coverage-final.json (Istanbul)
                    - lcov.info (LCOV; e.g. \`bun test --coverage\`)
                    - a directory containing exactly one of the above

Format auto-detected from filename / extension. Errors if a directory
holds both \`coverage-final.json\` and \`lcov.info\` (no precedence guess).

Flags:
  --json          Emit the result envelope on stdout. Default: human text.
  --help, -h      Show this help.

Output (JSON):
  { "format": "istanbul"|"lcov",
    "ingested": { "symbols": N, "files": M },
    "skipped": { "unmatched_files": K, "statements_no_symbol": S },
    "pruned_orphans": O }

Examples:
  codemap ingest-coverage coverage/coverage-final.json
  codemap ingest-coverage coverage/lcov.info
  codemap ingest-coverage coverage --json
`);
}

export function parseIngestCoverageRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; path: string; json: boolean } {
  if (rest[0] !== "ingest-coverage") {
    throw new Error("parseIngestCoverageRest: expected ingest-coverage");
  }
  let path: string | undefined;
  let json = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap ingest-coverage: unknown option "${a}". Run \`codemap ingest-coverage --help\` for usage.`,
      };
    }
    if (path !== undefined) {
      return {
        kind: "error",
        message: `codemap ingest-coverage: unexpected extra argument "${a}". Pass exactly one path.`,
      };
    }
    path = a;
  }
  if (path === undefined) {
    return {
      kind: "error",
      message: `codemap ingest-coverage: missing <path>. Run \`codemap ingest-coverage --help\` for usage.`,
    };
  }
  return { kind: "run", path, json };
}

/**
 * Resolve the user-supplied path to a concrete (artifact, format) pair.
 * Directory inputs probe for `coverage-final.json` and `lcov.info`;
 * presence of both is an explicit error per the plan ("no precedence
 * guessing — explicit is better than implicit").
 */
function resolveArtifact(
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

/**
 * Read a JSON file via the canonical Node-vs-Bun split — Bun.file().json()
 * uses Bun's native parser (materially faster on multi-MB Istanbul payloads);
 * Node falls through to readFile + JSON.parse. Mirrors `config.ts`.
 * See docs/packaging.md § Node vs Bun.
 */
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

export async function runIngestCoverageCmd(
  opts: IngestCoverageOpts,
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const { format, absPath } = resolveArtifact(opts.path, opts.root);

    let result: IngestResult;
    const db = openDb();
    try {
      if (format === "istanbul") {
        const payload = (await readJsonFile(absPath)) as IstanbulPayload;
        result = ingestIstanbul({
          db,
          projectRoot: opts.root,
          payload,
          sourcePath: absPath,
        });
      } else {
        const payload = await readTextFile(absPath);
        result = ingestLcov({
          db,
          projectRoot: opts.root,
          payload,
          sourcePath: absPath,
        });
      }
    } finally {
      closeDb(db);
    }

    if (opts.json) {
      console.log(JSON.stringify(result));
      return;
    }
    renderTerminal(result, absPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}

function renderTerminal(result: IngestResult, sourcePath: string): void {
  console.log(`# ingest-coverage format=${result.format} source=${sourcePath}`);
  console.log(
    `  ingested: ${result.ingested.symbols} symbols / ${result.ingested.files} files`,
  );
  if (result.skipped.unmatched_files > 0) {
    console.log(
      `  skipped:  ${result.skipped.unmatched_files} unmatched file(s) outside project root`,
    );
  }
  if (result.skipped.statements_no_symbol > 0) {
    console.log(
      `  skipped:  ${result.skipped.statements_no_symbol} statement(s) outside any symbol range`,
    );
  }
  if (result.pruned_orphans > 0) {
    console.log(
      `  pruned:   ${result.pruned_orphans} orphan row(s) for files no longer in the index`,
    );
  }
}
