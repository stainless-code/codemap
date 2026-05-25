import { searchSymbols } from "../application/search-engine";
import {
  buildSnippetResult,
  findSymbolsByName,
} from "../application/show-engine";
import type { SnippetResult, SymbolMatch } from "../application/show-engine";
import {
  parseAndNormalizeSearchQuery,
  resolveSearchWithFts,
} from "../application/show-search-mode";
import { toProjectRelative } from "../application/validate-engine";
import { closeDb, openDb } from "../db";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

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
  --with-fts         FTS phrase search for free-text tokens when indexed.
  --kind <kind>      Filter by symbols.kind (exact-name mode only).
  --in <path>        Filter by file scope (exact-name mode only).
  --json             Emit the JSON envelope (always wrapped in {matches}).
  --help, -h         Show this help.

Examples:
  codemap snippet runQueryCmd
  codemap snippet --query 'kind:function name:run' --json
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"snippet"`.
 */
export function parseSnippetRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      name: string | undefined;
      kindFilter: string | undefined;
      inPath: string | undefined;
      query: string | undefined;
      withFts: boolean;
      json: boolean;
    } {
  if (rest[0] !== "snippet") {
    throw new Error("parseSnippetRest: expected snippet");
  }

  let json = false;
  let name: string | undefined;
  let kindFilter: string | undefined;
  let inPath: string | undefined;
  let query: string | undefined;
  let withFts = false;

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
    if (a === "--query") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap snippet: "--query" requires a value.`,
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
          message: `codemap snippet: "--kind" requires a value.`,
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
          message: `codemap snippet: "--in" requires a value.`,
        };
      }
      inPath = next;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap snippet: unknown option "${a}". Run \`codemap snippet --help\` for usage.`,
      };
    }
    if (name !== undefined) {
      return {
        kind: "error",
        message: `codemap snippet: unexpected extra argument "${a}". Pass exactly one symbol name or use --query.`,
      };
    }
    name = a;
  }

  if (query !== undefined && name !== undefined) {
    return {
      kind: "error",
      message: "codemap snippet: pass either <name> or --query, not both.",
    };
  }

  if (query === undefined && name === undefined) {
    return {
      kind: "error",
      message: `codemap snippet: missing <name> or --query. Run \`codemap snippet --help\` for usage.`,
    };
  }

  if (
    query !== undefined &&
    (kindFilter !== undefined || inPath !== undefined)
  ) {
    return {
      kind: "error",
      message:
        "codemap snippet: --kind / --in apply to exact-name mode only; use kind: / path: / in: inside --query.",
    };
  }

  return {
    kind: "run",
    name,
    kindFilter,
    inPath,
    query,
    withFts,
    json,
  };
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
    const db = openDb();
    let matches: SymbolMatch[];
    let warning: string | undefined;
    try {
      if (opts.query !== undefined) {
        const parsedQuery = parseAndNormalizeSearchQuery(
          opts.query,
          projectRoot,
        );
        if (!parsedQuery.ok) {
          emitErrorMaybeJson(
            `codemap snippet: ${parsedQuery.error}`,
            opts.json,
          );
          return;
        }
        const fts = resolveSearchWithFts(db, {
          withFtsCli: opts.withFts,
          freeTextCount: parsedQuery.parsed.freeText.length,
        });
        if (fts.warning !== undefined) {
          console.error(`codemap snippet: ${fts.warning}`);
          warning = fts.warning;
        }
        matches = searchSymbols(db, {
          parsed: parsedQuery.parsed,
          withFts: fts.useFts,
        });
        if (matches.length === 0) {
          emitErrorMaybeJson(
            `codemap snippet: no symbols matched --query "${opts.query}". Try \`codemap show --query '${opts.query}' --print-sql\`.`,
            opts.json,
          );
          return;
        }
      } else {
        const inPath =
          opts.inPath !== undefined
            ? toProjectRelative(projectRoot, opts.inPath)
            : undefined;
        matches = findSymbolsByName(db, {
          name: opts.name!,
          kind: opts.kind,
          inPath,
        });
        if (matches.length === 0) {
          const filterDesc = describeFilter(opts.kind, inPath);
          const safeName = opts.name!.replace(/'/g, "''");
          const message = `codemap snippet: no symbol named "${opts.name}"${filterDesc}. Try \`codemap show --query 'name:${safeName}'\` for fuzzy lookup.`;
          emitErrorMaybeJson(message, opts.json);
          return;
        }
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

function describeFilter(
  kind: string | undefined,
  inPath: string | undefined,
): string {
  const parts: string[] = [];
  if (kind !== undefined) parts.push(`kind = "${kind}"`);
  if (inPath !== undefined) parts.push(`in = "${inPath}"`);
  return parts.length === 0 ? "" : ` (filters: ${parts.join(", ")})`;
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

function emitErrorMaybeJson(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
