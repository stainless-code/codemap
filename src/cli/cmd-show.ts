import { findSymbolsByName } from "../application/show-engine";
import type { SymbolMatch } from "../application/show-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { closeDb, openDb } from "../db";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { toProjectRelative } from "./cmd-validate";

/**
 * The catalog envelope returned by `show` — same shape both the CLI's
 * `--json` mode and the MCP `show` tool surface (per plan §4 uniformity
 * + Q-2 settled). Single match → `{matches: [{...}]}`; multi-match adds
 * a structured `disambiguation` block so agents narrow without scanning
 * every row.
 */
export interface ShowResult {
  matches: SymbolMatch[];
  disambiguation?: {
    n: number;
    by_kind: Record<string, number>;
    files: string[];
    hint: string;
  };
}

interface ShowOpts {
  root: string;
  configFile: string | undefined;
  name: string;
  kind: string | undefined;
  inPath: string | undefined;
  json: boolean;
}

/**
 * Print `codemap show` usage.
 */
export function printShowCmdHelp(): void {
  console.log(`Usage: codemap show <name> [--kind <kind>] [--in <path>] [--json]

Look up symbol(s) by exact name and return file_path:line_start-line_end +
signature. One-step lookup that beats composing
\`SELECT … FROM symbols WHERE name = ?\` by hand.

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
  { "matches": [ {name, kind, file_path, line_start, line_end, signature, ...}, ... ],
    "disambiguation"?: { "n": <count>, "by_kind": {...}, "files": [...], "hint": "..." } }

Examples:
  codemap show runQueryCmd
  codemap show foo --kind function
  codemap show foo --in src/cli
  codemap show runQueryCmd --json
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
      name: string;
      kindFilter: string | undefined;
      inPath: string | undefined;
      json: boolean;
    } {
  if (rest[0] !== "show") {
    throw new Error("parseShowRest: expected show");
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
        message: `codemap show: unexpected extra argument "${a}". Pass exactly one symbol name.`,
      };
    }
    name = a;
  }

  if (name === undefined) {
    return {
      kind: "error",
      message: `codemap show: missing <name>. Run \`codemap show --help\` for usage.`,
    };
  }

  return { kind: "run", name, kindFilter, inPath, json };
}

/**
 * Build the `ShowResult` envelope from a list of matches. Single-match
 * → `{matches}` only. Multi-match → adds a `disambiguation` block with
 * structured aids so agents narrow without scanning every row.
 */
export function buildShowResult(matches: SymbolMatch[]): ShowResult {
  if (matches.length <= 1) return { matches };
  const byKind: Record<string, number> = {};
  for (const m of matches) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  const files = Array.from(new Set(matches.map((m) => m.file_path))).sort();
  return {
    matches,
    disambiguation: {
      n: matches.length,
      by_kind: byKind,
      files,
      hint: "Multiple matches. Narrow with --kind <kind> or --in <path>.",
    },
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
    try {
      matches = findSymbolsByName(db, {
        name: opts.name,
        kind: opts.kind,
        inPath,
      });
    } finally {
      closeDb(db, { readonly: true });
    }

    if (matches.length === 0) {
      const filterDesc = describeFilter(opts.kind, inPath);
      // SQLite single-quote escape (`''`) — keeps the suggested SQL valid
      // when name contains apostrophes (e.g. `O'Brien`).
      const safeName = opts.name.replace(/'/g, "''");
      const message = `codemap show: no symbol named "${opts.name}"${filterDesc}. Try \`codemap query --json "SELECT name, file_path FROM symbols WHERE name LIKE '%${safeName}%'"\` for fuzzy lookup.`;
      emitErrorMaybeJson(message, opts.json);
      return;
    }

    const result = buildShowResult(matches);
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
