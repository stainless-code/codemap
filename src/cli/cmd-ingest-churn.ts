import { ingestChurnFromJsonFile } from "../application/ingest-churn-run";
import { closeDb, createSchema, openDb } from "../db";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface IngestChurnOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  path: string;
  json: boolean;
}

export function printIngestChurnCmdHelp(): void {
  console.log(`Usage: codemap ingest-churn <path> [--json]

Import precomputed git churn metrics into \`file_churn\` for non-git
repositories or CI fixtures (same JSON shape as config \`churn.file\`).
Replaces all \`file_churn\` rows — include every indexed path you want
retained. Enables \`churn-complexity-hotspots\`. JSON must be an array of
objects with \`file_path\`, \`commit_count\`, \`weighted_commits\`, optional
\`lines_added\` / \`lines_removed\` (default 0), \`last_commit_at\` /
\`churn_trend\` (\`accelerating\` \| \`stable\` \| \`cooling\`) /
\`computed_at\` (defaults to current time). Run \`codemap\` (index) first —
only indexed paths are kept; unindexed paths are skipped.

Args:
  <path>          Path to JSON file (relative to project root or absolute)

Flags:
  --json          Emit result envelope on stdout
  --help, -h      Show this help

Output (JSON):
  { "ingested": N, "skipped_unindexed": K, "sourcePath": "..." }

Examples:
  codemap ingest-churn metrics/churn.json
  codemap ingest-churn metrics/churn.json --json
`);
}

export function parseIngestChurnRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; path: string; json: boolean } {
  if (rest[0] !== "ingest-churn") {
    throw new Error("parseIngestChurnRest: expected ingest-churn");
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
        message: `codemap ingest-churn: unknown option "${a}"`,
      };
    }
    if (path !== undefined) {
      return {
        kind: "error",
        message: "codemap ingest-churn: unexpected extra path argument",
      };
    }
    path = a;
  }
  if (!path) {
    return {
      kind: "error",
      message: "codemap ingest-churn: missing <path> argument",
    };
  }
  return { kind: "run", path, json };
}

export async function runIngestChurnCmd(opts: IngestChurnOpts): Promise<void> {
  await bootstrapCodemap(opts);
  const db = openDb();
  try {
    createSchema(db);
    const indexedCount =
      db.query<{ n: number }>("SELECT COUNT(*) AS n FROM files").get()?.n ?? 0;
    if (indexedCount === 0) {
      console.error(
        "codemap ingest-churn: no indexed files — run `codemap` or `codemap --full` first",
      );
      process.exit(1);
    }
    const result = ingestChurnFromJsonFile(db, {
      projectRoot: opts.root,
      path: opts.path,
    });
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    if (opts.json) {
      console.log(
        JSON.stringify({
          ingested: result.ingested,
          skipped_unindexed: result.skipped_unindexed,
          sourcePath: result.sourcePath,
        }),
      );
    } else {
      console.log(
        `  Ingested ${result.ingested} file_churn rows from ${result.sourcePath}` +
          (result.skipped_unindexed > 0
            ? ` (${result.skipped_unindexed} skipped — not in index)`
            : ""),
      );
    }
  } finally {
    closeDb(db);
  }
}
