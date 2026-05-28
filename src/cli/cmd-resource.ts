import {
  buildFileRollup,
  buildSchemaCatalog,
  buildSymbolLookup,
  unknownFileResourceError,
  unknownSymbolResourceError,
} from "../application/resource-handlers";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { emitJsonError, emitJsonPayload } from "./emit-tool-result";

interface ResourceCmdOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  compact: boolean;
}

export function printFileCmdHelp(): void {
  console.log(`Usage: codemap file <path> [--compact]

Per-file structural roll-up (symbols, imports, exports, coverage). Same JSON
as MCP resource \`codemap://files/{path}\` / HTTP \`GET /resources/...\`.

Args:
  <path>                Project-relative file path.

Flags:
  --compact             Minify JSON (default: pretty-printed).
  --help, -h            Show this help.

Examples:
  codemap file src/db.ts
  codemap file src/parser.ts --compact
`);
}

export function parseFileRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; path: string; compact: boolean } {
  if (rest[0] !== "file") {
    throw new Error("parseFileRest: expected file");
  }

  let path: string | undefined;
  let compact = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap file: unknown option "${a}". Run codemap file --help for usage.`,
      };
    }
    if (path !== undefined) {
      return {
        kind: "error",
        message: `codemap file: unexpected extra argument "${a}". Pass exactly one path.`,
      };
    }
    path = a;
  }

  if (path === undefined) {
    return {
      kind: "error",
      message:
        "codemap file: missing <path>. Run codemap file --help for usage.",
    };
  }

  return { kind: "run", path, compact };
}

export async function runFileCmd(
  opts: ResourceCmdOpts & { path: string },
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const payload = buildFileRollup(opts.path);
    if (payload === undefined) {
      emitJsonError(unknownFileResourceError(opts.path));
      return;
    }
    emitJsonPayload(payload, { pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitJsonError(msg);
  }
}

export function printSchemaCmdHelp(): void {
  console.log(`Usage: codemap schema [--compact]

DDL for every user table in the index DB. Same JSON as MCP resource
\`codemap://schema\` / HTTP \`GET /resources/...\`.

Flags:
  --compact             Minify JSON (default: pretty-printed).
  --help, -h            Show this help.

Examples:
  codemap schema
  codemap schema --compact | jq '.[].name'
`);
}

export function parseSchemaRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; compact: boolean } {
  if (rest[0] !== "schema") {
    throw new Error("parseSchemaRest: expected schema");
  }

  let compact = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    return {
      kind: "error",
      message: `codemap schema: unknown option "${a}". Run codemap schema --help for usage.`,
    };
  }

  return { kind: "run", compact };
}

export async function runSchemaCmd(opts: ResourceCmdOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    emitJsonPayload(buildSchemaCatalog(), { pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitJsonError(msg);
  }
}

export function printSymbolsCmdHelp(): void {
  console.log(`Usage: codemap symbols <name> [--in <path>] [--compact]

Exact-name symbol lookup. Same JSON as MCP resource
\`codemap://symbols/{name}\` / HTTP \`GET /resources/...\`.

Args:
  <name>                Exact symbol name (case-sensitive).

Flags:
  --in <path>           Filter by file path prefix (mirrors resource \`?in=\`).
  --compact             Minify JSON (default: pretty-printed).
  --help, -h            Show this help.

Examples:
  codemap symbols handleQuery
  codemap symbols foo --in src/db.ts --compact
`);
}

export function parseSymbolsRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      name: string;
      inPath: string | undefined;
      compact: boolean;
    } {
  if (rest[0] !== "symbols") {
    throw new Error("parseSymbolsRest: expected symbols");
  }

  let name: string | undefined;
  let inPath: string | undefined;
  let compact = false;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--in") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) {
        return {
          kind: "error",
          message: 'codemap symbols: "--in" requires a path prefix.',
        };
      }
      inPath = v;
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap symbols: unknown option "${a}". Run codemap symbols --help for usage.`,
      };
    }
    if (name !== undefined) {
      return {
        kind: "error",
        message: `codemap symbols: unexpected extra argument "${a}". Pass exactly one symbol name.`,
      };
    }
    name = a;
  }

  if (name === undefined) {
    return {
      kind: "error",
      message:
        "codemap symbols: missing <name>. Run codemap symbols --help for usage.",
    };
  }

  return { kind: "run", name, inPath, compact };
}

export async function runSymbolsCmd(
  opts: ResourceCmdOpts & { name: string; inPath: string | undefined },
): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const payload = buildSymbolLookup(opts.name, opts.inPath);
    if (payload === undefined) {
      emitJsonError(unknownSymbolResourceError(opts.name, opts.inPath));
      return;
    }
    emitJsonPayload(payload, { pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitJsonError(msg);
  }
}
