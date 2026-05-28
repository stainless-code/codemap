import type { ToolResult } from "../application/tool-handlers";

/** Tool-shaped MCP/HTTP handlers use {@link emitToolResult}; resource URIs use {@link emitJsonPayload}. */

export interface EmitToolResultOpts {
  /** When true, errors go to stdout as `{"error":"…"}` (CLI --json convention). */
  json: boolean;
  /** Pretty-print JSON payloads (default true when json). */
  pretty?: boolean;
}

export interface EmitJsonPayloadOpts {
  pretty?: boolean;
}

/** Print a JSON object/array to stdout (composer + resource CLI verbs). */
export function emitJsonPayload(
  payload: unknown,
  opts: EmitJsonPayloadOpts = {},
): void {
  const pretty = opts.pretty !== false;
  console.log(
    pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload),
  );
}

/** Print `{"error":"…"}` to stdout and set exit code (JSON-only CLI verbs). */
export function emitJsonError(message: string): void {
  emitJsonPayload({ error: message }, { pretty: false });
  process.exitCode = 1;
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

  emitJsonPayload(result.payload, {
    pretty: opts.pretty !== false && opts.json,
  });
}
