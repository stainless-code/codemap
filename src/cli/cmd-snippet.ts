import { buildSnippetResult } from "../application/show-engine";
import type { SnippetResult } from "../application/show-engine";
import {
  executeShowLookup,
  resolveShowLookupMode,
} from "../application/show-search-mode";
import { closeDb, openDb } from "../db";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { parseShowSnippetRest } from "./show-snippet-args";
import {
  buildExactNameEmptyMessage,
  emitErrorMaybeJson,
} from "./show-snippet-render";

interface SnippetOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  name: string | undefined;
  kind: string | undefined;
  inPath: string | undefined;
  query: string | undefined;
  withFts: boolean;
  json: boolean;
}

/**
 * Print `codemap snippet` usage.
 */
export function printSnippetCmdHelp(): void {
  console.log(`Usage: codemap snippet <name> [--kind <kind>] [--in <path>] [--json]
       codemap snippet --query '<field:value …>' [--with-fts] [--json]

Look up symbol(s) by exact name and return the source text from disk
(plus the same metadata \`codemap show\` returns). Same lookup semantics
as \`show\`; difference is the response carries the actual code body
sliced from disk at line_start..line_end.

Args:
  <name>             Exact symbol name (case-sensitive). Omit when using
                     --query.

Flags:
  --query <q>        Field-qualified discovery search (same as show).
  --with-fts         FTS phrase search for free-text tokens when indexed
                     (matches file bodies — returns all symbols in matching
                     files, not symbol-level body hits).
  --kind <kind>      Filter by symbols.kind (exact-name mode only).
  --in <path>        Filter by file scope (exact-name mode only).
  --json             Emit the JSON envelope (always wrapped in {matches}).
  --help, -h         Show this help.

Output (JSON): same {matches, disambiguation?, warning?} as show; each match
adds source / stale / missing.

Examples:
  codemap snippet runQueryCmd
  codemap snippet --query 'kind:function name:run' --json
`);
}

/** Parse `argv` after the bootstrap split: `rest[0]` must be `"snippet"`. */
export function parseSnippetRest(rest: string[]) {
  const parsed = parseShowSnippetRest(rest, {
    verb: "snippet",
    allowPrintSql: false,
  });
  if (parsed.kind !== "run") return parsed;
  const { printSql: _printSql, ...run } = parsed;
  return run;
}

/**
 * Run `codemap snippet <name>`. Mirrors `runShowCmd`'s shape — bootstrap,
 * lookup, render. JSON mode prints the envelope verbatim; terminal mode
 * prints `path:line-line` + signature + source per row, with a stderr
 * staleness hint when any row is stale.
 */
export async function runSnippetCmd(opts: SnippetOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const projectRoot = getProjectRoot();

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
      emitErrorMaybeJson(`codemap snippet: ${mode.error}`, opts.json);
      return;
    }

    const db = openDb();
    try {
      const { matches, warning } = executeShowLookup(db, mode, {
        withFtsCli: opts.withFts,
        exactKind: opts.kind,
      });
      if (warning !== undefined) {
        console.error(`codemap snippet: ${warning}`);
      }

      const isQuery = mode.kind === "query";
      if (matches.length === 0) {
        if (isQuery) {
          const empty = buildSnippetResult({ db, matches, projectRoot });
          if (warning !== undefined) empty.warning = warning;
          if (opts.json) {
            console.log(JSON.stringify(empty));
            return;
          }
          console.error(
            `codemap snippet: no symbols matched --query "${opts.query}". Try \`codemap show --query '${opts.query}' --print-sql\`.`,
          );
          process.exitCode = 1;
          return;
        }
        const inPath = mode.kind === "exact" ? mode.inPath : undefined;
        emitErrorMaybeJson(
          buildExactNameEmptyMessage("snippet", opts.name!, opts.kind, inPath),
          opts.json,
        );
        return;
      }

      const result = buildSnippetResult({ db, matches, projectRoot });
      if (warning !== undefined) result.warning = warning;
      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }
      renderSnippetTerminal(result);
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

export function renderSnippetTerminal(result: SnippetResult): void {
  let anyStale = false;
  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i]!;
    if (i > 0) console.log("");
    const stalePrefix = m.stale ? " [STALE]" : "";
    const missingPrefix = m.missing ? " [MISSING]" : "";
    console.log(
      `${m.file_path}:${m.line_start}-${m.line_end}${stalePrefix}${missingPrefix}`,
    );
    console.log(`  ${m.signature}`);
    if (m.source !== undefined) console.log(m.source);
    if (m.stale) anyStale = true;
  }
  if (result.disambiguation !== undefined) {
    console.error(
      `\n# ${result.disambiguation.n} matches — ${result.disambiguation.hint}`,
    );
  }
  if (anyStale) {
    console.error(
      `\n# Some snippets are stale (file changed since last index). Run \`codemap\` or \`codemap --files <path>\` to refresh.`,
    );
  }
}
