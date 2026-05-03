import { runMcpServer } from "../application/mcp-server";
import { DEFAULT_DEBOUNCE_MS } from "../application/watcher";
import { CODEMAP_VERSION } from "../version";

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"mcp"`.
 * `--root` / `--config` are absorbed by bootstrap. `--watch` /
 * `--debounce <ms>` boot a co-process watcher (per
 * [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage)) so the
 * MCP server's tools always read live data without per-request reindex.
 */
export function parseMcpRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      watch: boolean;
      debounceMs: number;
    } {
  if (rest[0] !== "mcp") {
    throw new Error("parseMcpRest: expected mcp");
  }

  // CODEMAP_WATCH=1 / "true" is the env shortcut for IDE / CI launches
  // that can't easily edit the agent host's tool spawn command.
  const envWatch =
    process.env["CODEMAP_WATCH"] === "1" ||
    process.env["CODEMAP_WATCH"] === "true";
  let watch = envWatch;
  let debounceMs = DEFAULT_DEBOUNCE_MS;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--watch") {
      watch = true;
      continue;
    }
    if (a === "--debounce" || a.startsWith("--debounce=")) {
      const eq = a.indexOf("=");
      const v = eq !== -1 ? a.slice(eq + 1) : rest[i + 1];
      if (v === undefined || v === "" || v.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap mcp: "--debounce" requires a non-negative integer (milliseconds).',
        };
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        return {
          kind: "error",
          message: `codemap mcp: "--debounce ${v}" is not a non-negative integer.`,
        };
      }
      debounceMs = n;
      if (eq === -1) i++;
      continue;
    }
    return {
      kind: "error",
      message: `codemap mcp: unknown option "${a}". Run \`codemap mcp --help\` for usage.`,
    };
  }

  return { kind: "run", watch, debounceMs };
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

Flags:
  --watch              Boot a co-process file watcher so every tool reads
                       a live index — eliminates the per-request reindex
                       prelude. Equivalent to \`codemap watch\` running in
                       parallel; use this killer combo to remove the
                       'is the index stale?' friction agents hit today.
                       Also enabled when CODEMAP_WATCH=1.
  --debounce <ms>      Coalesce burst events into one reindex after <ms>
                       of quiet (default: ${DEFAULT_DEBOUNCE_MS}). Only meaningful with
                       --watch.
  --help, -h           Show this help.

Global flags (parsed by bootstrap, forwarded to the server):
  --root <dir>      Project root (defaults to cwd; respects CODEMAP_ROOT).
  --config <file>   Config file path (defaults to codemap.config.{ts,js,json}).

The server stays running until stdin closes (the agent host disconnects).
With --watch, the file watcher is drained before the server exits.
`);
}

/**
 * Entry-point for `codemap mcp`. Boots the MCP server over stdio and
 * resolves when the transport closes (clean shutdown via stdin EOF).
 * With `watch: true`, also boots a co-process file watcher so the
 * server's tools always read live data. Bootstrap / DB / SDK errors
 * propagate as exit code 1 via main.
 */
export async function runMcpCmd(opts: {
  root: string;
  configFile: string | undefined;
  watch: boolean;
  debounceMs: number;
}): Promise<void> {
  await runMcpServer({
    version: CODEMAP_VERSION,
    root: opts.root,
    configFile: opts.configFile,
    watch: opts.watch,
    debounceMs: opts.debounceMs,
  });
}
