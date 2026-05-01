import { runMcpServer } from "../application/mcp-server";
import { CODEMAP_VERSION } from "../version";

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"mcp"`.
 * v1 takes no MCP-specific flags — `--root` / `--config` are absorbed
 * by the bootstrap layer and forwarded via `runMcpCmd`'s opts.
 */
export function parseMcpRest(
  rest: string[],
): { kind: "help" } | { kind: "error"; message: string } | { kind: "run" } {
  if (rest[0] !== "mcp") {
    throw new Error("parseMcpRest: expected mcp");
  }

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--help" || a === "-h") return { kind: "help" };
    return {
      kind: "error",
      message: `codemap mcp: unknown option "${a}". Run \`codemap mcp --help\` for usage.`,
    };
  }

  return { kind: "run" };
}

export function printMcpCmdHelp(): void {
  console.log(`Usage: codemap mcp

Spawns an MCP (Model Context Protocol) server on stdio. Designed to be
launched by an agent host (Claude Code, Cursor, Codex, generic MCP
clients) — JSON-RPC on stdin/stdout, logs on stderr.

Tools (one per CLI verb plus the MCP-only batch helper; snake_case):
  query                One read-only SQL statement.
  query_batch          N statements in one round-trip (MCP-only).
  query_recipe         Bundled SQL recipe by id; per-row \`actions\` hints.
  audit                Structural-drift audit ({head, deltas} envelope).
  save_baseline        Snapshot rows under a name (sql or recipe).
  list_baselines       Catalog of saved baselines.
  drop_baseline        Delete a baseline.
  context              Project bootstrap envelope.
  validate             On-disk hash vs indexed hash.

Resources (lazy-cached on first read):
  codemap://recipes              Full recipe catalog.
  codemap://recipes/{id}         Single recipe (id, description, sql).
  codemap://schema               Live DDL of every table.
  codemap://skill                Bundled SKILL.md.

Output shape is verbatim from each tool's CLI counterpart \`--json\`
envelope (no re-mapping). See docs/architecture.md § MCP wiring for
the engine seam and the agent rule + skill for query examples.

Global flags (parsed by bootstrap, forwarded to the server):
  --root <dir>      Project root (defaults to cwd; respects CODEMAP_ROOT).
  --config <file>   Config file path (defaults to codemap.config.{ts,js,json}).

The server stays running until stdin closes (the agent host disconnects).
`);
}

/**
 * Entry-point for `codemap mcp`. Boots the MCP server over stdio and
 * resolves when the transport closes (clean shutdown via stdin EOF).
 * Bootstrap / DB / SDK errors propagate as exit code 1 via main.
 */
export async function runMcpCmd(opts: {
  root: string;
  configFile: string | undefined;
}): Promise<void> {
  await runMcpServer({
    version: CODEMAP_VERSION,
    root: opts.root,
    configFile: opts.configFile,
  });
}
