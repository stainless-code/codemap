import { handleContext } from "../application/tool-handlers";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { emitToolResult } from "./emit-tool-result";

interface ContextOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  compact: boolean;
  intent: string | null;
  includeSnippets: boolean;
}

/**
 * Print **`codemap context`** usage.
 */
export function printContextCmdHelp(): void {
  console.log(`Usage: codemap context [--compact] [--for "<intent>"] [--include-snippets]

Emit a JSON envelope describing the current index — project metadata, top
hubs (fan-in), a sample of markers, session-start shortcuts (start_here),
and the recipe catalog (bundled + project-local). Designed for agents and
editors that want a single-command "give me everything cheap".

Flags:
  --compact          Drop hubs, sample_markers, and start_here; emit JSON
                     without pretty-print (smaller payload).
  --for "<intent>"   Pre-classify a free-text intent (refactor, debug, test,
                     feature, explore) and recommend recipes that match.
  --include-snippets One-line export previews on hub leaders (ignored when
                     --compact). Same as MCP \`context\` \`include_snippets\`.
  --help, -h         Show this help.

Examples:
  codemap context
  codemap context --compact
  codemap context --for "refactor the auth module"
  codemap context --include-snippets
`);
}

/**
 * Parse `argv` after the bootstrap split: `rest[0]` must be `"context"`.
 */
export function parseContextRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      compact: boolean;
      intent: string | null;
      includeSnippets: boolean;
    } {
  if (rest[0] !== "context") {
    throw new Error("parseContextRest: expected context");
  }
  let compact = false;
  let intent: string | null = null;
  let includeSnippets = false;
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--compact") {
      compact = true;
      continue;
    }
    if (a === "--include-snippets") {
      includeSnippets = true;
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
  return { kind: "run", compact, intent, includeSnippets };
}

/**
 * Initialize Codemap for `opts.root`, then print the context envelope as JSON.
 */
export async function runContextCmd(opts: ContextOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);
    const result = handleContext({
      compact: opts.compact,
      intent: opts.intent ?? undefined,
      include_snippets: opts.includeSnippets,
    });
    emitToolResult(result, { json: true, pretty: !opts.compact });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitToolResult({ ok: false, error: msg }, { json: true });
  }
}
