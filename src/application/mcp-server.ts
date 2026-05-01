import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * MCP server engine — owns the tool/resource registry. The CLI shell
 * (`src/cli/cmd-mcp.ts`) only handles argv parsing and lifecycle; this
 * module is the thin wrapper around `@modelcontextprotocol/sdk` that
 * registers codemap's tools (one per CLI verb — see plan § 3) and
 * resources (see plan § 7).
 *
 * Tracer 1: only the `ping` stub tool is registered so `codemap mcp`
 * boots end-to-end and the SDK / stdio transport wiring is validated.
 * Subsequent tracers (2-7) add `query`, `query_recipe`, `audit`,
 * baseline tools, and resources.
 */
export function createMcpServer(opts: {
  version: string;
  // root + configFile are accepted now so tracers 2+ don't have to
  // re-thread the constructor — they're unused in the ping stub.
  root: string;
  configFile?: string | undefined;
}): McpServer {
  const server = new McpServer({
    name: "codemap",
    version: opts.version,
  });

  // Stub tool — confirms SDK + stdio wiring without depending on any
  // codemap engine. Replaced in tracer 2 with the real `query` tool.
  server.registerTool(
    "ping",
    {
      description:
        "Health check: returns the server name and a timestamp. Replaced by `query` in tracer 2.",
    },
    () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            server: "codemap",
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  return server;
}

/**
 * Starts the MCP server over stdio (the only transport in v1; HTTP is
 * deferred to v1.x — see plan § 2). Resolves when the transport closes
 * (stdin EOF). Logs to stderr per MCP convention so stdout stays
 * dedicated to JSON-RPC framing.
 */
export async function runMcpServer(opts: {
  version: string;
  root: string;
  configFile?: string | undefined;
}): Promise<void> {
  const server = createMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The transport keeps running until stdin closes; `server.connect`
  // resolves once the connect handshake is done, but we want this
  // function to stay open until the session ends. Wait on the
  // underlying transport's close.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
