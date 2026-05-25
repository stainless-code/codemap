import {
  buildSymbolSearchSql,
  formatSymbolSearchSqlForDisplay,
  isSourceFtsPopulated,
  searchSymbols,
} from "../application/search-engine";
import { parseSearchQuery } from "../application/search-query-parser";
import { buildShowResult, findSymbolsByName } from "../application/show-engine";
import type { ShowResult, SymbolMatch } from "../application/show-engine";
import { toProjectRelative } from "../application/validate-engine";
import { closeDb, openDb } from "../db";
import { getFts5Enabled, getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface ShowOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  name: string | undefined;
  kind: string | undefined;
  inPath: string | undefined;
  query: string | undefined;
  withFts: boolean;
  printSql: boolean;
  json: boolean;
}

/**
 * Print `codemap show` usage.
 */
export function printShowCmdHelp(): void {
  console.log(`Usage: codemap show <name> [--kind <kind>] [--in <path>] [--json]
       codemap show --query '<field:value …>' [--with-fts] [--print-sql] [--json]

Look up symbol(s) by exact name and return file_path:line_start-line_end +
signature. One-step lookup that beats composing
\`SELECT … FROM symbols WHERE name = ?\` by hand.

Field-qualified search (--query):
  kind:<kind>        Exact symbols.kind (function, class, const, …).
  name:<pattern>     Case-sensitive substring on symbols.name (LIKE).
  path:<path>        File scope — directory prefix or exact file path.
  in:<glob>          SQLite GLOB on file_path (e.g. in:src/**/*.ts).
  Free text          Unqualified tokens → name LIKE (or source_fts MATCH
                     with --with-fts when FTS5 is indexed).

Args:
  <name>             Exact symbol name (case-sensitive). Omit when using
                     --query.

Flags:
  --query <q>        Field-qualified discovery search (see above).
  --with-fts         For --query free-text tokens, search file bodies via
                     source_fts when the index was built with FTS5.
  --print-sql        With --query, print generated SQL and exit (no DB read).
  --kind <kind>      Filter by symbols.kind (exact-name mode only).
  --in <path>        Filter by file scope (exact-name mode only).
  --json             Emit the JSON envelope (always wrapped in {matches}).
  --help, -h         Show this help.

Output (JSON, all cases):
  { "matches": [ {name, kind, file_path, line_start, line_end, signature, ...}, ... ],
    "disambiguation"?: { "n": <count>, "by_kind": {...}, "files": [...], "hint": "..." } }

Examples:
  codemap show runQueryCmd
  codemap show foo --kind function
  codemap show --query 'kind:function name:Auth path:src/'
  codemap show --query 'name:"useQuery"' --json
  codemap show --query 'Auth' --with-fts
  codemap show --query 'kind:function name:foo' --print-sql
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"show"`.
 */
export function parseShowRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      name: string | undefined;
      kindFilter: string | undefined;
      inPath: string | undefined;
      query: string | undefined;
      withFts: boolean;
      printSql: boolean;
      json: boolean;
    } {
  if (rest[0] !== "show") {
    throw new Error("parseShowRest: expected show");
  }

  let json = false;
  let name: string | undefined;
  let kindFilter: string | undefined;
  let inPath: string | undefined;
  let query: string | undefined;
  let withFts = false;
  let printSql = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--with-fts") {
      withFts = true;
      continue;
    }
    if (a === "--print-sql") {
      printSql = true;
      continue;
    }
    if (a === "--query") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap show: "--query" requires a value.`,
        };
      }
      query = next;
      i++;
      continue;
    }
    if (a === "--kind") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap show: "--kind" requires a value.`,
        };
      }
      kindFilter = next;
      i++;
      continue;
    }
    if (a === "--in") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap show: "--in" requires a value.`,
        };
      }
      inPath = next;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap show: unknown option "${a}". Run \`codemap show --help\` for usage.`,
      };
    }
    if (name !== undefined) {
      return {
        kind: "error",
        message: `codemap show: unexpected extra argument "${a}". Pass exactly one symbol name or use --query.`,
      };
    }
    name = a;
  }

  if (query !== undefined && name !== undefined) {
    return {
      kind: "error",
      message: "codemap show: pass either <name> or --query, not both.",
    };
  }

  if (query === undefined && name === undefined) {
    return {
      kind: "error",
      message: `codemap show: missing <name> or --query. Run \`codemap show --help\` for usage.`,
    };
  }

  if (printSql && query === undefined) {
    return {
      kind: "error",
      message: `codemap show: "--print-sql" requires --query.`,
    };
  }

  if (
    query !== undefined &&
    (kindFilter !== undefined || inPath !== undefined)
  ) {
    return {
      kind: "error",
      message:
        "codemap show: --kind / --in apply to exact-name mode only; use kind: / path: / in: inside --query.",
    };
  }

  return {
    kind: "run",
    name,
    kindFilter,
    inPath,
    query,
    withFts,
    printSql,
    json,
  };
}

/**
 * Run `codemap show <name>`. Bootstraps codemap, opens db, looks up,
 * renders. Sets `process.exitCode` (no `process.exit`) so piped stdout
 * isn't truncated. Errors emit the `{"error":"…"}` envelope on stdout
 * under `--json`, plain message on stderr otherwise.
 */
export async function runShowCmd(opts: ShowOpts): Promise<void> {
  try {
    if (opts.printSql && opts.query !== undefined) {
      await bootstrapCodemap(opts);
      runShowPrintSql(opts.query, opts.withFts);
      return;
    }

    await bootstrapCodemap(opts);

    const projectRoot = getProjectRoot();

    if (opts.query !== undefined) {
      await runShowQueryMode(opts, projectRoot);
      return;
    }

    const inPath =
      opts.inPath !== undefined
        ? toProjectRelative(projectRoot, opts.inPath)
        : undefined;

    const db = openDb();
    let matches: SymbolMatch[];
    try {
      matches = findSymbolsByName(db, {
        name: opts.name!,
        kind: opts.kind,
        inPath,
      });
    } finally {
      closeDb(db, { readonly: true });
    }

    renderShowMatches(matches, {
      json: opts.json,
      emptyMessage: buildExactEmptyMessage(opts.name!, opts.kind, inPath),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

async function runShowQueryMode(
  opts: ShowOpts,
  projectRoot: string,
): Promise<void> {
  const parsedQuery = parseSearchQuery(opts.query!);
  if (!parsedQuery.ok) {
    emitErrorMaybeJson(`codemap show: ${parsedQuery.error}`, opts.json);
    return;
  }

  let path = parsedQuery.parsed.path;
  if (path !== undefined) {
    path = toProjectRelative(projectRoot, path);
    parsedQuery.parsed.path = path;
  }

  const db = openDb();
  let matches: SymbolMatch[];
  try {
    const useFts = resolveSearchWithFts(
      db,
      opts.withFts,
      parsedQuery.parsed.freeText.length,
    );
    matches = searchSymbols(db, {
      parsed: parsedQuery.parsed,
      withFts: useFts,
    });
  } finally {
    closeDb(db, { readonly: true });
  }

  renderShowMatches(matches, {
    json: opts.json,
    emptyMessage: `codemap show: no symbols matched --query "${opts.query}". Try --print-sql to inspect the generated SQL.`,
  });
}

function runShowPrintSql(query: string, withFtsCli: boolean): void {
  const parsedQuery = parseSearchQuery(query);
  if (!parsedQuery.ok) {
    console.error(`codemap show: ${parsedQuery.error}`);
    process.exitCode = 1;
    return;
  }

  let useFts = withFtsCli;
  if (useFts && parsedQuery.parsed.freeText.length > 0) {
    try {
      const db = openDb();
      try {
        if (!isSourceFtsPopulated(db)) {
          console.error(
            "codemap show: --with-fts ignored — source_fts is empty. Re-index with --with-fts or fts5: true.",
          );
          useFts = false;
        }
      } finally {
        closeDb(db, { readonly: true });
      }
    } catch {
      useFts = false;
    }
  } else {
    useFts = false;
  }

  const built = buildSymbolSearchSql({
    parsed: parsedQuery.parsed,
    withFts: useFts,
  });
  console.log(formatSymbolSearchSqlForDisplay(built));
}

function resolveSearchWithFts(
  db: ReturnType<typeof openDb>,
  withFtsCli: boolean,
  freeTextCount: number,
): boolean {
  if (freeTextCount === 0) return false;
  const wantFts = withFtsCli || getFts5Enabled();
  if (!wantFts) return false;
  if (!isSourceFtsPopulated(db)) {
    if (withFtsCli) {
      console.error(
        "codemap show: --with-fts ignored — source_fts is empty. Re-index with --with-fts or fts5: true.",
      );
    }
    return false;
  }
  return true;
}

function renderShowMatches(
  matches: SymbolMatch[],
  opts: { json: boolean; emptyMessage: string },
): void {
  if (matches.length === 0) {
    emitErrorMaybeJson(opts.emptyMessage, opts.json);
    return;
  }

  const result = buildShowResult(matches);
  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }
  renderTerminal(result);
}

function buildExactEmptyMessage(
  name: string,
  kind: string | undefined,
  inPath: string | undefined,
): string {
  const filterDesc = describeFilter(kind, inPath);
  const safeName = name.replace(/'/g, "''");
  return `codemap show: no symbol named "${name}"${filterDesc}. Try \`codemap show --query 'name:${safeName}'\` or \`codemap query --json "SELECT name, file_path FROM symbols WHERE name LIKE '%${safeName}%'"\` for fuzzy lookup.`;
}

function describeFilter(
  kind: string | undefined,
  inPath: string | undefined,
): string {
  const parts: string[] = [];
  if (kind !== undefined) parts.push(`kind = "${kind}"`);
  if (inPath !== undefined) parts.push(`in = "${inPath}"`);
  return parts.length === 0 ? "" : ` (filters: ${parts.join(", ")})`;
}

function renderTerminal(result: ShowResult): void {
  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i]!;
    if (i > 0) console.log("");
    console.log(`${m.file_path}:${m.line_start}-${m.line_end}`);
    console.log(`  ${m.signature}`);
  }
  if (result.disambiguation !== undefined) {
    console.error(
      `\n# ${result.disambiguation.n} matches — ${result.disambiguation.hint}`,
    );
  }
}

function emitErrorMaybeJson(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
