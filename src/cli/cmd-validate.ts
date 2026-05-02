import { computeValidateRows } from "../application/validate-engine";
import type { ValidateRow } from "../application/validate-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

interface ValidateOpts {
  root: string;
  configFile: string | undefined;
  paths: string[];
  json?: boolean;
}

/**
 * Print **`codemap validate`** usage.
 */
export function printValidateCmdHelp(): void {
  console.log(`Usage: codemap validate [--json] [paths...]

Compare the SHA-256 stored in .codemap.db against the on-disk content of each
file. Prints rows for entries that are out of sync — without the agent paying
to re-read every file.

  paths       Project-relative or absolute file paths to check. If omitted,
              all indexed files are checked.

Statuses:
  stale       The file exists but its content_hash differs from the index.
  missing     The file is in the index but has been deleted on disk.
  unindexed   The file exists on disk but is not present in the index (only
              when explicit paths are passed).

Flags:
  --json      Emit a JSON array of {path, status} objects (for agents).
  --help, -h  Show this help.

Examples:
  codemap validate                       # check every indexed file
  codemap validate src/parser.ts         # check just one file
  codemap validate --json src/a.ts src/b.ts
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"validate"`.
 */
export function parseValidateRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; paths: string[]; json: boolean } {
  if (rest[0] !== "validate") {
    throw new Error("parseValidateRest: expected validate");
  }
  let json = false;
  const paths: string[] = [];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap: unknown option "${a}". Run codemap validate --help for usage.`,
      };
    }
    paths.push(a);
  }
  return { kind: "run", paths, json };
}

/**
 * Initialize Codemap for `opts.root`, then print the staleness report.
 * Sets **`process.exitCode`** to **1** if any rows are returned (mirrors
 * `git status` semantics so agents can branch on `$?`).
 */
export async function runValidateCmd(opts: ValidateOpts): Promise<void> {
  const json = opts.json === true;
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());
    const db = openDb();
    let rows: ValidateRow[];
    try {
      rows = computeValidateRows(db, getProjectRoot(), opts.paths);
    } finally {
      closeDb(db, { readonly: true });
    }
    if (json) {
      console.log(JSON.stringify(rows));
    } else if (rows.length === 0) {
      console.log("(everything in sync)");
    } else {
      console.table(rows);
    }
    if (rows.length > 0) process.exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}
