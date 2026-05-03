import { buildContextEnvelope } from "../application/context-engine";
import type { ContextEnvelope } from "../application/context-engine";
import { closeDb, openDb } from "../db";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface ContextOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  compact: boolean;
  intent: string | null;
}

/**
 * Print **`codemap context`** usage.
 */
export function printContextCmdHelp(): void {
  console.log(`Usage: codemap context [--compact] [--for "<intent>"]

Emit a JSON envelope describing the current index — project metadata, top
hubs (fan-in), a sample of markers, and the bundled recipe catalog. Designed
for agents and editors that want a single-command "give me everything cheap".

Flags:
  --compact          Drop hubs and sample_markers; emit JSON without
                     pretty-print (smaller payload).
  --for "<intent>"   Pre-classify a free-text intent (refactor, debug, test,
                     feature, explore) and recommend recipes that match.
  --help, -h         Show this help.

Examples:
  codemap context
  codemap context --compact
  codemap context --for "refactor the auth module"
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"context"`.
 */
export function parseContextRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; compact: boolean; intent: string | null } {
  if (rest[0] !== "context") {
    throw new Error("parseContextRest: expected context");
  }
  let compact = false;
  let intent: string | null = null;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--for") {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--") || v.trim() === "") {
        return {
          kind: "error",
          message: 'codemap: "--for" requires an intent string in quotes.',
        };
      }
      intent = v.trim();
      i++;
      continue;
    }
    return {
      kind: "error",
      message: `codemap: unknown option "${a}". Run codemap context --help for usage.`,
    };
  }
  return { kind: "run", compact, intent };
}

/**
 * Initialize Codemap for `opts.root`, then print the context envelope as JSON.
 */
export async function runContextCmd(opts: ContextOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const db = openDb();
    let envelope: ContextEnvelope;
    try {
      envelope = buildContextEnvelope(db, getProjectRoot(), {
        compact: opts.compact,
        intent: opts.intent,
      });
    } finally {
      closeDb(db, { readonly: true });
    }
    console.log(
      opts.compact
        ? JSON.stringify(envelope)
        : JSON.stringify(envelope, null, 2),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ error: msg }));
    process.exitCode = 1;
  }
}
