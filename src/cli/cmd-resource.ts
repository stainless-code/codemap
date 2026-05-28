import { stdin as input } from "node:process";

import {
  buildFileRollup,
  buildSchemaCatalog,
} from "../application/resource-handlers";
import { bootstrapCodemap } from "./bootstrap-codemap";

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
      console.log(JSON.stringify({ error: `file not indexed: ${opts.path}` }));
      process.exitCode = 1;
      return;
    }
    console.log(
      opts.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ error: msg }));
    process.exitCode = 1;
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
    const payload = buildSchemaCatalog();
    console.log(
      opts.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ error: msg }));
    process.exitCode = 1;
  }
}

export async function readJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    throw new Error("codemap query batch: stdin was empty.");
  }
  return JSON.parse(text) as unknown;
}
