import { z } from "zod";

import {
  exploreArgsSchema,
  handleExplore,
  handleNode,
  handleTrace,
  nodeArgsSchema,
  traceArgsSchema,
} from "../application/tool-handlers";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { emitToolResult } from "./emit-tool-result";

interface ComposerBootstrapOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
}

function parsePositiveIntFlag(
  flag: string,
  value: string | undefined,
  verb: string,
): { ok: true; n: number } | { ok: false; message: string } {
  if (value === undefined) {
    return {
      ok: false,
      message: `codemap ${verb}: "${flag}" requires a positive integer.`,
    };
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ok: false,
      message: `codemap ${verb}: "${flag} ${value}" must be a positive integer.`,
    };
  }
  return { ok: true, n };
}

function firstZodIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? error.message;
}

export function printTraceCmdHelp(): void {
  console.log(`Usage: codemap trace --from <symbol> --to <symbol> [--max-depth <N>] [--via calls|dependencies|all] [--budget-chars <N>] [--compact]

Shortest call path between two symbols plus budget-capped snippets. Same
payload as the MCP \`trace\` tool / HTTP \`POST /tool/trace\`. Always emits JSON.

Flags:
  --from <symbol>       Start symbol (required).
  --to <symbol>         End symbol (required).
  --max-depth <N>       BFS cap (non-negative integer).
  --via <b>             calls | dependencies | all (default all).
  --budget-chars <N>    Snippet char budget (adaptive 15k/10k/6k when omitted).
  --compact             Minify JSON (default: pretty-printed).
  --help, -h            Show this help.

Examples:
  codemap trace --from handleQuery --to executeQuery
  codemap trace --from foo --to bar --via calls --budget-chars 8000 --compact
`);
}

export function parseTraceRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      from: string;
      to: string;
      maxDepth: number | undefined;
      via: "calls" | "dependencies" | "all" | undefined;
      budgetChars: number | undefined;
      compact: boolean;
    } {
  if (rest[0] !== "trace") {
    throw new Error("parseTraceRest: expected trace");
  }

  let from: string | undefined;
  let to: string | undefined;
  let maxDepth: number | undefined;
  let via: "calls" | "dependencies" | "all" | undefined;
  let budgetChars: number | undefined;
  let compact = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--from") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap trace: "--from" requires a symbol name.',
        };
      }
      from = v;
      i++;
      continue;
    }
    if (a === "--to") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap trace: "--to" requires a symbol name.',
        };
      }
      to = v;
      i++;
      continue;
    }
    if (a === "--max-depth") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message:
            'codemap trace: "--max-depth" requires a non-negative integer.',
        };
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return {
          kind: "error",
          message: `codemap trace: "--max-depth ${v}" must be a non-negative integer.`,
        };
      }
      maxDepth = n;
      i++;
      continue;
    }
    if (a === "--via") {
      const v = rest[i + 1];
      if (v !== "calls" && v !== "dependencies" && v !== "all") {
        return {
          kind: "error",
          message:
            'codemap trace: "--via" must be calls, dependencies, or all.',
        };
      }
      via = v;
      i++;
      continue;
    }
    if (a === "--budget-chars") {
      const v = rest[i + 1];
      const parsed = parsePositiveIntFlag("--budget-chars", v, "trace");
      if (!parsed.ok) return { kind: "error", message: parsed.message };
      budgetChars = parsed.n;
      i++;
      continue;
    }
    return {
      kind: "error",
      message: `codemap trace: unknown option "${a}". Run codemap trace --help for usage.`,
    };
  }

  if (from === undefined || to === undefined) {
    return {
      kind: "error",
      message:
        "codemap trace: --from and --to are required. Run codemap trace --help for usage.",
    };
  }

  return {
    kind: "run",
    from,
    to,
    maxDepth,
    via,
    budgetChars,
    compact,
  };
}

export async function runTraceCmd(
  opts: ComposerBootstrapOpts & {
    from: string;
    to: string;
    maxDepth: number | undefined;
    via: "calls" | "dependencies" | "all" | undefined;
    budgetChars: number | undefined;
    compact: boolean;
  },
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const validated = z.object(traceArgsSchema).safeParse({
      from: opts.from,
      to: opts.to,
      max_depth: opts.maxDepth,
      via: opts.via,
      budget_chars: opts.budgetChars,
    });
    if (!validated.success) {
      emitToolResult(
        { ok: false, error: firstZodIssue(validated.error) },
        { json: true },
      );
      return;
    }
    const root = getProjectRoot();
    const result = handleTrace(validated.data, root);
    emitToolResult(result, { json: true, pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitToolResult({ ok: false, error: msg }, { json: true });
  }
}

export function printExploreCmdHelp(): void {
  console.log(`Usage: codemap explore <name>... [--depth <N>] [--kind <k>] [--budget-chars <N>] [--compact]

Multi-symbol neighborhood survey with budget-capped snippets. Same payload
as the MCP \`explore\` tool / HTTP \`POST /tool/explore\`. Always emits JSON.

Args:
  <name>...             One or more symbol names (required).

Flags:
  --depth <N>           Neighborhood depth (non-negative integer).
  --kind <k>            Filter neighborhood rows by symbol kind.
  --budget-chars <N>    Snippet char budget (adaptive when omitted).
  --compact             Minify JSON.
  --help, -h            Show this help.

Examples:
  codemap explore handleQuery executeQuery
  codemap explore foo --depth 2 --kind function --compact
`);
}

export function parseExploreRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      names: string[];
      depth: number | undefined;
      kindFilter: string | undefined;
      budgetChars: number | undefined;
      compact: boolean;
    } {
  if (rest[0] !== "explore") {
    throw new Error("parseExploreRest: expected explore");
  }

  const names: string[] = [];
  let depth: number | undefined;
  let kindFilter: string | undefined;
  let budgetChars: number | undefined;
  let compact = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--depth") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message:
            'codemap explore: "--depth" requires a non-negative integer.',
        };
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return {
          kind: "error",
          message: `codemap explore: "--depth ${v}" must be a non-negative integer.`,
        };
      }
      depth = n;
      i++;
      continue;
    }
    if (a === "--kind") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap explore: "--kind" requires a value.',
        };
      }
      kindFilter = v;
      i++;
      continue;
    }
    if (a === "--budget-chars") {
      const v = rest[i + 1];
      const parsed = parsePositiveIntFlag("--budget-chars", v, "explore");
      if (!parsed.ok) return { kind: "error", message: parsed.message };
      budgetChars = parsed.n;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap explore: unknown option "${a}". Run codemap explore --help for usage.`,
      };
    }
    names.push(a);
  }

  if (names.length === 0) {
    return {
      kind: "error",
      message:
        "codemap explore: pass at least one symbol name. Run codemap explore --help for usage.",
    };
  }

  return {
    kind: "run",
    names,
    depth,
    kindFilter,
    budgetChars,
    compact,
  };
}

export async function runExploreCmd(
  opts: ComposerBootstrapOpts & {
    names: string[];
    depth: number | undefined;
    kindFilter: string | undefined;
    budgetChars: number | undefined;
    compact: boolean;
  },
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const validated = z.object(exploreArgsSchema).safeParse({
      names: opts.names,
      depth: opts.depth,
      kind: opts.kindFilter,
      budget_chars: opts.budgetChars,
    });
    if (!validated.success) {
      emitToolResult(
        { ok: false, error: firstZodIssue(validated.error) },
        { json: true },
      );
      return;
    }
    const root = getProjectRoot();
    const result = handleExplore(validated.data, root);
    emitToolResult(result, { json: true, pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitToolResult({ ok: false, error: msg }, { json: true });
  }
}

export function printNodeCmdHelp(): void {
  console.log(`Usage: codemap node <name> [--kind <k>] [--in <path>] [--include-snippets] [--budget-chars <N>] [--compact]

One-hop symbol survey: show center + scoped depth-1 neighborhood. Same
payload as the MCP \`node\` tool / HTTP \`POST /tool/node\`. Always emits JSON.

Args:
  <name>                Symbol name (required).

Flags:
  --kind <k>            Disambiguate by kind.
  --in <path>           Disambiguate by file path prefix.
  --include-snippets    Attach budget-capped source snippets.
  --budget-chars <N>    Snippet budget when --include-snippets (adaptive when omitted).
  --compact             Minify JSON.
  --help, -h            Show this help.

Examples:
  codemap node handleQuery
  codemap node foo --in src/db.ts --include-snippets --compact
`);
}

export function parseNodeRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      name: string;
      kindFilter: string | undefined;
      inPath: string | undefined;
      includeSnippets: boolean;
      budgetChars: number | undefined;
      compact: boolean;
    } {
  if (rest[0] !== "node") {
    throw new Error("parseNodeRest: expected node");
  }

  let name: string | undefined;
  let kindFilter: string | undefined;
  let inPath: string | undefined;
  let includeSnippets = false;
  let budgetChars: number | undefined;
  let compact = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--include-snippets") {
      includeSnippets = true;
      continue;
    }
    if (a === "--kind") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap node: "--kind" requires a value.',
        };
      }
      kindFilter = v;
      i++;
      continue;
    }
    if (a === "--in") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap node: "--in" requires a path prefix.',
        };
      }
      inPath = v;
      i++;
      continue;
    }
    if (a === "--budget-chars") {
      const v = rest[i + 1];
      const parsed = parsePositiveIntFlag("--budget-chars", v, "node");
      if (!parsed.ok) return { kind: "error", message: parsed.message };
      budgetChars = parsed.n;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap node: unknown option "${a}". Run codemap node --help for usage.`,
      };
    }
    if (name !== undefined) {
      return {
        kind: "error",
        message: `codemap node: unexpected extra argument "${a}". Pass exactly one symbol name.`,
      };
    }
    name = a;
  }

  if (name === undefined) {
    return {
      kind: "error",
      message:
        "codemap node: missing <name>. Run codemap node --help for usage.",
    };
  }

  return {
    kind: "run",
    name,
    kindFilter,
    inPath,
    includeSnippets,
    budgetChars,
    compact,
  };
}

export async function runNodeCmd(
  opts: ComposerBootstrapOpts & {
    name: string;
    kindFilter: string | undefined;
    inPath: string | undefined;
    includeSnippets: boolean;
    budgetChars: number | undefined;
    compact: boolean;
  },
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const validated = z.object(nodeArgsSchema).safeParse({
      name: opts.name,
      kind: opts.kindFilter,
      in: opts.inPath,
      include_snippets: opts.includeSnippets,
      budget_chars: opts.budgetChars,
    });
    if (!validated.success) {
      emitToolResult(
        { ok: false, error: firstZodIssue(validated.error) },
        { json: true },
      );
      return;
    }
    const root = getProjectRoot();
    const result = handleNode(validated.data, root);
    emitToolResult(result, { json: true, pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitToolResult({ ok: false, error: msg }, { json: true });
  }
}
