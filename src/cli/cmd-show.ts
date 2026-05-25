import {
  buildSymbolSearchSql,
  formatSymbolSearchSqlForDisplay,
} from "../application/search-engine";
import { buildShowResult } from "../application/show-engine";
import type { ShowResult } from "../application/show-engine";
import {
  executeShowLookup,
  parseAndNormalizeSearchQuery,
  resolveSearchWithFts,
  resolveShowLookupMode,
} from "../application/show-search-mode";
import { closeDb, openDb } from "../db";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { parseShowSnippetRest } from "./show-snippet-args";

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
  Free text          Unqualified tokens → name LIKE, or source_fts phrase
                     search when FTS5 is indexed (--with-fts or fts5: true).
                     With FTS, matches file bodies — returns all symbols in
                     matching files (not symbol-level body hits).

Args:
  <name>             Exact symbol name (case-sensitive). Omit when using
                     --query.

Flags:
  --query <q>        Field-qualified discovery search (see above).
  --with-fts         Force FTS for free-text tokens (also on when fts5: true
                     in config and source_fts is populated).
  --print-sql        With --query, print generated SQL and exit (opens DB
                     only when FTS probe needs source_fts).
  --kind <kind>      Filter by symbols.kind (exact-name mode only).
  --in <path>        Filter by file scope (exact-name mode only).
  --json             Emit the JSON envelope (always wrapped in {matches}).
  --help, -h         Show this help.

Output (JSON, all cases):
  { "matches": [ {name, kind, file_path, line_start, line_end, signature, ...}, ... ],
    "disambiguation"?: { "n": <count>, "by_kind": {...}, "files": [...], "hint": "..." },
    "warning"?: "<fts fallback message>" }

Examples:
  codemap show runQueryCmd
  codemap show foo --kind function
  codemap show --query 'kind:function name:Auth path:src/'
  codemap show --query 'name:"useQuery"' --json
  codemap show --query 'Auth' --with-fts
  codemap show --query 'kind:function name:foo' --print-sql
`);
}

/** Parse `argv` after the bootstrap split: `rest[0]` must be `"show"`. */
export function parseShowRest(rest: string[]) {
  return parseShowSnippetRest(rest, { verb: "show", allowPrintSql: true });
}

/**
 * Run `codemap show <name>`. Bootstraps codemap, opens db, looks up,
 * renders. Sets `process.exitCode` (no `process.exit`) so piped stdout
 * isn't truncated. Errors emit the `{"error":"…"}` envelope on stdout
 * under `--json`, plain message on stderr otherwise.
 */
export async function runShowCmd(opts: ShowOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const projectRoot = getProjectRoot();

    if (opts.printSql && opts.query !== undefined) {
      runShowPrintSql(opts.query, projectRoot, opts.withFts);
      return;
    }

    const mode = resolveShowLookupMode(
      {
        name: opts.name,
        query: opts.query,
        kind: opts.kind,
        in: opts.inPath,
      },
      projectRoot,
    );
    if (!mode.ok) {
      emitErrorMaybeJson(`codemap show: ${mode.error}`, opts.json);
      return;
    }

    const db = openDb();
    try {
      const { matches, warning } = executeShowLookup(db, mode, {
        withFtsCli: opts.withFts,
        exactKind: opts.kind,
      });
      if (warning !== undefined) {
        console.error(`codemap show: ${warning}`);
      }

      const isQuery = mode.kind === "query";
      renderShowMatches(matches, {
        json: opts.json,
        warning,
        isQuery,
        emptyMessage: isQuery
          ? `codemap show: no symbols matched --query "${opts.query}". Try --print-sql to inspect the generated SQL.`
          : buildExactEmptyMessage(
              opts.name!,
              opts.kind,
              mode.kind === "exact" ? mode.inPath : undefined,
            ),
      });
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

function runShowPrintSql(
  query: string,
  projectRoot: string,
  withFtsCli: boolean,
): void {
  const parsedQuery = parseAndNormalizeSearchQuery(query, projectRoot);
  if (!parsedQuery.ok) {
    console.error(`codemap show: ${parsedQuery.error}`);
    process.exitCode = 1;
    return;
  }

  let useFts = false;
  if (parsedQuery.parsed.freeText.length > 0) {
    try {
      const db = openDb();
      try {
        const fts = resolveSearchWithFts(db, {
          withFtsCli,
          freeTextCount: parsedQuery.parsed.freeText.length,
        });
        if (fts.warning !== undefined) {
          console.error(`codemap show: ${fts.warning}`);
        }
        useFts = fts.useFts;
      } finally {
        closeDb(db, { readonly: true });
      }
    } catch {
      useFts = false;
    }
  }

  const built = buildSymbolSearchSql({
    parsed: parsedQuery.parsed,
    withFts: useFts,
  });
  console.log(formatSymbolSearchSqlForDisplay(built));
}

function renderShowMatches(
  matches: ReturnType<typeof executeShowLookup>["matches"],
  opts: {
    json: boolean;
    emptyMessage: string;
    warning?: string | undefined;
    isQuery: boolean;
  },
): void {
  if (matches.length === 0) {
    if (opts.isQuery) {
      const empty = buildShowResult([]);
      if (opts.warning !== undefined) empty.warning = opts.warning;
      if (opts.json) {
        console.log(JSON.stringify(empty));
        return;
      }
      console.error(opts.emptyMessage);
      process.exitCode = 1;
      return;
    }
    emitErrorMaybeJson(opts.emptyMessage, opts.json);
    return;
  }

  const result = buildShowResult(matches);
  if (opts.warning !== undefined) result.warning = opts.warning;
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
