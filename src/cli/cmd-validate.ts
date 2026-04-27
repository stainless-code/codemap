import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import type { CodemapDatabase } from "../db";
import { hashContent } from "../hash";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

/**
 * One row in the staleness report. `status` distinguishes the three cases an
 * agent might want to act on differently.
 */
export interface ValidateRow {
  path: string;
  status: "stale" | "missing" | "unindexed";
}

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
 * Walk the indexed files (or the explicit `paths` set), comparing on-disk
 * SHA-256 to `files.content_hash`. Returns rows that are out of sync. Pure
 * function over an open DB and the project root — covered by unit tests.
 */
export function computeValidateRows(
  db: CodemapDatabase,
  projectRoot: string,
  explicitPaths: string[],
): ValidateRow[] {
  const indexed = db.query("SELECT path, content_hash FROM files").all() as {
    path: string;
    content_hash: string;
  }[];

  const indexByPath = new Map<string, string>();
  for (const row of indexed) indexByPath.set(row.path, row.content_hash);

  const targets =
    explicitPaths.length === 0 ? indexed.map((r) => r.path) : explicitPaths;

  const seen = new Set<string>();
  const rows: ValidateRow[] = [];
  for (const raw of targets) {
    const rel = toProjectRelative(projectRoot, raw);
    if (seen.has(rel)) continue;
    seen.add(rel);

    const indexedHash = indexByPath.get(rel);
    const abs = resolve(projectRoot, rel);
    let source: string | undefined;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      source = undefined;
    }

    if (indexedHash === undefined) {
      if (source !== undefined) rows.push({ path: rel, status: "unindexed" });
      continue;
    }
    if (source === undefined) {
      rows.push({ path: rel, status: "missing" });
      continue;
    }
    if (hashContent(source) !== indexedHash) {
      rows.push({ path: rel, status: "stale" });
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

/**
 * Convert a CLI-supplied path to a project-relative POSIX-style key matching
 * the `files.path` format stored in the index. `path.relative()` returns
 * backslash-separated paths on Windows; the index always stores forward
 * slashes (tinyglobby / Bun.Glob / git diff all emit POSIX), so we normalize
 * here to make `indexByPath.get(rel)` succeed cross-platform.
 */
function toProjectRelative(projectRoot: string, p: string): string {
  const rel = isAbsolute(p) ? relative(projectRoot, p) : p;
  return sep === "/" ? rel : rel.split(sep).join("/");
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
