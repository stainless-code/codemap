import {
  findSymbolsByName,
  getIndexedContentHash,
  readSymbolSource,
} from "../application/show-engine";
import type { SymbolMatch } from "../application/show-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import type { CodemapDatabase } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { toProjectRelative } from "./cmd-validate";

/**
 * Per-match payload returned by `snippet` — extends the `show` row shape
 * with the source text and stale-flag fields. Same row shape as
 * `findSymbolsByName` returns plus three additive fields:
 * `source` (the file lines from line_start..line_end),
 * `stale` (true when the file's content_hash drifted since indexing),
 * `missing` (true when the file no longer exists on disk).
 */
export interface SnippetMatch extends SymbolMatch {
  source: string | undefined;
  stale: boolean;
  missing: boolean;
}

/**
 * The catalog envelope returned by `snippet` — same shape as `show`'s
 * `ShowResult` (per Q-2 + Q-5: snippet adds source/stale/missing on each
 * row but keeps the {matches, disambiguation?} envelope). Single match
 * → `{matches: [{...}]}`; multi-match adds the structured disambiguation
 * block.
 */
export interface SnippetResult {
  matches: SnippetMatch[];
  disambiguation?: {
    n: number;
    by_kind: Record<string, number>;
    files: string[];
    hint: string;
  };
}

interface SnippetOpts {
  root: string;
  configFile: string | undefined;
  name: string;
  kind: string | undefined;
  inPath: string | undefined;
  json: boolean;
}

/**
 * Print `codemap snippet` usage.
 */
export function printSnippetCmdHelp(): void {
  console.log(`Usage: codemap snippet <name> [--kind <kind>] [--in <path>] [--json]

Look up symbol(s) by exact name and return the source text from disk
(plus the same metadata \`codemap show\` returns). Same lookup semantics
as \`show\`; difference is the response carries the actual code body
sliced from disk at line_start..line_end.

Args:
  <name>             Exact symbol name (case-sensitive).

Flags:
  --kind <kind>      Filter by symbols.kind (function / class / const / …).
  --in <path>        Filter by file scope. Trailing slash or no extension
                     in the trailing segment treats as prefix; otherwise
                     exact file match.
  --json             Emit the JSON envelope (always wrapped in {matches}).
  --help, -h         Show this help.

Output (JSON, all cases):
  { "matches": [ {name, kind, file_path, line_start, line_end, signature,
                  source, stale, missing, ...}, ... ],
    "disambiguation"?: { "n": <count>, "by_kind": {...}, "files": [...], "hint": "..." } }

Stale-file behavior: if the file's content hash drifted since the last
index run, the row carries \`stale: true\` and the source is still
returned (read from disk). If the file is missing on disk, the row
carries \`missing: true\` and source is null. The agent decides whether
to act on stale content or re-index first.

Examples:
  codemap snippet runQueryCmd
  codemap snippet foo --kind function
  codemap snippet runQueryCmd --json
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"snippet"`.
 * Same shape as `parseShowRest` — same flag set + same error UX.
 */
export function parseSnippetRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      name: string;
      kindFilter: string | undefined;
      inPath: string | undefined;
      json: boolean;
    } {
  if (rest[0] !== "snippet") {
    throw new Error("parseSnippetRest: expected snippet");
  }

  let json = false;
  let name: string | undefined;
  let kindFilter: string | undefined;
  let inPath: string | undefined;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
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
        message: `codemap snippet: unexpected extra argument "${a}". Pass exactly one symbol name.`,
      };
    }
    name = a;
  }

  if (name === undefined) {
    return {
      kind: "error",
      message: `codemap snippet: missing <name>. Run \`codemap snippet --help\` for usage.`,
    };
  }

  return { kind: "run", name, kindFilter, inPath, json };
}

/**
 * Build the `SnippetResult` envelope from matches + per-match source reads.
 * Mirrors `buildShowResult` from `cmd-show.ts` but enriches each match with
 * `source` / `stale` / `missing` fields read fresh from disk per Q-6
 * (read + flag, no auto-reindex).
 */
export function buildSnippetResult(opts: {
  db: CodemapDatabase;
  matches: SymbolMatch[];
  projectRoot: string;
}): SnippetResult {
  const enriched: SnippetMatch[] = opts.matches.map((m) => {
    const indexedHash = getIndexedContentHash(opts.db, m.file_path);
    const read = readSymbolSource({
      match: m,
      projectRoot: opts.projectRoot,
      indexedContentHash: indexedHash,
    });
    return {
      ...m,
      source: read.source,
      stale: read.stale,
      missing: read.missing,
    };
  });

  if (enriched.length <= 1) return { matches: enriched };
  const byKind: Record<string, number> = {};
  for (const m of enriched) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  const files = Array.from(new Set(enriched.map((m) => m.file_path))).sort();
  return {
    matches: enriched,
    disambiguation: {
      n: enriched.length,
      by_kind: byKind,
      files,
      hint: "Multiple matches. Narrow with --kind <kind> or --in <path>.",
    },
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
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());

    const projectRoot = getProjectRoot();
    const inPath =
      opts.inPath !== undefined
        ? toProjectRelative(projectRoot, opts.inPath)
        : undefined;

    const db = openDb();
    let matches: SymbolMatch[];
    let result: SnippetResult;
    try {
      matches = findSymbolsByName(db, {
        name: opts.name,
        kind: opts.kind,
        inPath,
      });
      if (matches.length === 0) {
        const filterDesc = describeFilter(opts.kind, inPath);
        // SQLite single-quote escape (`''`) — keeps the suggested SQL valid
        // when name contains apostrophes (e.g. `O'Brien`).
        const safeName = opts.name.replace(/'/g, "''");
        const message = `codemap snippet: no symbol named "${opts.name}"${filterDesc}. Try \`codemap query --json "SELECT name, file_path FROM symbols WHERE name LIKE '%${safeName}%'"\` for fuzzy lookup.`;
        emitErrorMaybeJson(message, opts.json);
        return;
      }
      result = buildSnippetResult({ db, matches, projectRoot });
    } finally {
      closeDb(db, { readonly: true });
    }

    if (opts.json) {
      console.log(JSON.stringify(result));
      return;
    }
    renderTerminal(result);
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

function renderTerminal(result: SnippetResult): void {
  let anyStale = false;
  for (let i = 0; i < result.matches.length; i++) {
    const m = result.matches[i]!;
    if (i > 0) console.log("");
    const stalePrefix = m.stale ? " [STALE]" : "";
    const missingPrefix = m.missing ? " [MISSING]" : "";
    console.log(
      `${m.file_path}:${m.line_start}-${m.line_end}${stalePrefix}${missingPrefix}`,
    );
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
