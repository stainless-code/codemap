import type { ToolResult } from "../application/tool-handlers";

export interface EmitToolResultOpts {
  /** When true, errors go to stdout as `{"error":"…"}` (CLI --json convention). */
  json: boolean;
  /** Pretty-print JSON payloads (default true when json). */
  pretty?: boolean;
}

/**
 * Print a transport-agnostic {@link ToolResult} the way MCP/HTTP JSON tools
 * would — same payload shape, CLI error envelope on failure.
 */
export function emitToolResult(
  result: ToolResult,
  opts: EmitToolResultOpts,
): void {
  if (!result.ok) {
    if (opts.json) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(result.error);
    }
    process.exitCode = 1;
    return;
  }

  if (result.format !== "json") {
    console.log(result.payload);
    return;
  }

  const pretty = opts.pretty !== false && opts.json;
  console.log(
    pretty
      ? JSON.stringify(result.payload, null, 2)
      : JSON.stringify(result.payload),
  );
}
