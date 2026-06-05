import type { IngestResult } from "../application/coverage-engine";
import { runIngestCoverageOnDb } from "../application/ingest-coverage-run";
import { closeDb, openDb } from "../db";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface IngestCoverageOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  path: string;
  json: boolean;
  runtime: boolean;
}

export function printIngestCoverageCmdHelp(): void {
  console.log(`Usage: codemap ingest-coverage <path> [--runtime] [--json]

Ingest a coverage artifact into the index so structural queries can
compose coverage filters in pure SQL. No test runner is invoked —
codemap reads what \`bun test\`, \`vitest\`, \`jest\`, \`c8\`, \`nyc\`,
or Node's V8 protocol already produce.

Args:
  <path>          Path to one of:
                    - coverage-final.json (Istanbul)
                    - lcov.info (LCOV; e.g. \`bun test --coverage\`)
                    - a directory containing exactly one of the above
                    - a NODE_V8_COVERAGE directory (with --runtime)

Format auto-detected from filename / extension. Errors if a directory
holds both \`coverage-final.json\` and \`lcov.info\` (no precedence guess).

Flags:
  --runtime       Treat <path> as a NODE_V8_COVERAGE directory and merge
                  every \`coverage-*.json\` inside it. Skip files whose
                  \`url\` isn't \`file://\` (Node internals, eval). Local
                  use only — no SaaS aggregation.
  --json          Emit the result envelope on stdout. Default: human text.
  --help, -h      Show this help.

Output (JSON):
  { "format": "istanbul"|"lcov"|"v8",
    "ingested": { "symbols": N, "files": M },
    "skipped": { "unmatched_files": K, "statements_no_symbol": S },
    "pruned_orphans": O }

Examples:
  codemap ingest-coverage coverage/coverage-final.json
  codemap ingest-coverage coverage/lcov.info
  codemap ingest-coverage coverage --json
  NODE_V8_COVERAGE=.cov bun test
  codemap ingest-coverage .cov --runtime --json
`);
}

export function parseIngestCoverageRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; path: string; json: boolean; runtime: boolean } {
  if (rest[0] !== "ingest-coverage") {
    throw new Error("parseIngestCoverageRest: expected ingest-coverage");
  }
  let path: string | undefined;
  let json = false;
  let runtime = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--runtime") {
      runtime = true;
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
  return { kind: "run", path, json, runtime };
}

export async function runIngestCoverageCmd(
  opts: IngestCoverageOpts,
): Promise<void> {
  try {
    await bootstrapCodemap(opts);

    const db = openDb();
    let outcome: Awaited<ReturnType<typeof runIngestCoverageOnDb>>;
    try {
      outcome = await runIngestCoverageOnDb(db, {
        projectRoot: opts.root,
        path: opts.path,
        runtime: opts.runtime,
      });
    } finally {
      closeDb(db);
    }

    if (!outcome.ok) {
      if (opts.json) {
        console.log(JSON.stringify({ error: outcome.error }));
      } else {
        console.error(outcome.error);
      }
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(outcome.result));
      return;
    }
    renderTerminal(outcome.result, outcome.sourcePath);
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
