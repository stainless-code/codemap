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

  // Default-ON watcher (PR adds default-ON; pre-flip default was OFF).
  // `mcp` is inherently long-running — stale-index friction is the
  // most-frequent agent UX issue, so the watcher pays for itself
  // immediately. CODEMAP_WATCH=0 / "false" is the env shortcut to opt
  // out (mirrors --no-watch) for IDE / CI launches that can't easily
  // edit the agent host's tool spawn command. CODEMAP_WATCH=1 / "true"
  // is redundant after the default flip but kept for backwards-compat.
  const envWatchOff =
    process.env["CODEMAP_WATCH"] === "0" ||
    process.env["CODEMAP_WATCH"] === "false";
  let watch = !envWatchOff;
  let debounceMs = DEFAULT_DEBOUNCE_MS;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--watch") {
      // No-op after default-ON flip; kept so existing scripts/launch
      // commands that pass --watch explicitly still parse cleanly.
      watch = true;
      continue;
    }
    if (a === "--no-watch") {
      watch = false;
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
  show                 Symbol metadata: file:line + signature.
  snippet              Same lookup + source text from disk.
  impact               Symbol/file blast-radius walker (callers, callees,
                       dependents, dependencies).

Resources:
  Lazy-cached catalog (reads once per server lifetime):
    codemap://recipes            Full recipe catalog.
    codemap://recipes/{id}       Single recipe (id, description, sql).
    codemap://schema             Live DDL of every table.
    codemap://skill              Bundled SKILL.md.
  Live read-per-call (no caching — see latest indexed state every read):
    codemap://files/{path}       Per-file roll-up (symbols, imports,
                                 exports, coverage). URI-encode the path.
    codemap://symbols/{name}     Symbol lookup; \`?in=<path-prefix>\`
                                 mirrors \`show --in <path>\`. Returns
                                 {matches, disambiguation?}.

Output shape is verbatim from each tool's CLI counterpart \`--json\`
envelope (no re-mapping). See docs/architecture.md § MCP wiring for
the engine seam and the agent rule + skill for query examples.

Flags:
  --watch              [default ON] Boot a co-process file watcher so
                       every tool reads a live index — eliminates the
                       per-request reindex prelude. Equivalent to
                       \`codemap watch\` running in parallel. Default-ON
                       since 2026-05; explicit flag kept for backwards-
                       compat with existing launch scripts.
  --no-watch           Opt out of the default watcher. Use when you
                       want one-shot tool calls without spawning the
                       chokidar co-process (CI scripts that fire-and-
                       forget, ephemeral indexes, etc.). Same effect as
                       CODEMAP_WATCH=0 / "false" in the environment.
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
  stateDir?: string | undefined;
  watch: boolean;
  debounceMs: number;
}): Promise<void> {
  await runMcpServer({
    version: CODEMAP_VERSION,
    root: opts.root,
    configFile: opts.configFile,
    stateDir: opts.stateDir,
    watch: opts.watch,
    debounceMs: opts.debounceMs,
  });
}
