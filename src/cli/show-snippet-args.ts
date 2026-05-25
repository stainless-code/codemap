export interface ShowSnippetRunArgs {
  name: string | undefined;
  kindFilter: string | undefined;
  inPath: string | undefined;
  query: string | undefined;
  withFts: boolean;
  printSql: boolean;
  json: boolean;
}

export type ParseShowSnippetRestResult =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | ({ kind: "run" } & ShowSnippetRunArgs);

/**
 * Shared argv parser for `codemap show` and `codemap snippet` (same flags except
 * show-only `--print-sql`).
 */
export function parseShowSnippetRest(
  rest: string[],
  opts: { verb: "show" | "snippet"; allowPrintSql: boolean },
): ParseShowSnippetRestResult {
  if (rest[0] !== opts.verb) {
    throw new Error(`parseShowSnippetRest: expected ${opts.verb}`);
  }

  const prefix = `codemap ${opts.verb}`;
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
      if (!opts.allowPrintSql) {
        return {
          kind: "error",
          message: `${prefix}: unknown option "--print-sql". Run \`${prefix} --help\` for usage.`,
        };
      }
      printSql = true;
      continue;
    }
    if (a === "--query") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: `${prefix}: "--query" requires a value.`,
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
          message: `${prefix}: "--kind" requires a value.`,
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
          message: `${prefix}: "--in" requires a value.`,
        };
      }
      inPath = next;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `${prefix}: unknown option "${a}". Run \`${prefix} --help\` for usage.`,
      };
    }
    if (name !== undefined) {
      return {
        kind: "error",
        message: `${prefix}: unexpected extra argument "${a}". Pass exactly one symbol name or use --query.`,
      };
    }
    name = a;
  }

  if (query !== undefined && name !== undefined) {
    return {
      kind: "error",
      message: `${prefix}: pass either <name> or --query, not both.`,
    };
  }

  if (query === undefined && name === undefined) {
    return {
      kind: "error",
      message: `${prefix}: missing <name> or --query. Run \`${prefix} --help\` for usage.`,
    };
  }

  if (printSql && query === undefined) {
    return {
      kind: "error",
      message: `${prefix}: "--print-sql" requires --query.`,
    };
  }

  if (
    query !== undefined &&
    (kindFilter !== undefined || inPath !== undefined)
  ) {
    return {
      kind: "error",
      message: `${prefix}: --kind / --in apply to exact-name mode only; use kind: / path: / in: inside --query.`,
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
