import { resolve } from "node:path";

import { CODEMAP_VERSION } from "../version";

/**
 * Printed for `codemap --help` / `-h` (must run before config or DB access).
 */
export function printCliUsage(): void {
  console.log(`Usage: codemap [options] [command]

Index (default): update .codemap/index.db for the project root (\`--root\` or cwd).
  codemap [--root DIR] [--config FILE] [--full]
  codemap [--root DIR] [--config FILE] --files <paths...>

Query:
  codemap query [--json] "<SQL>"
  codemap query [--json] --recipe <id>
  codemap query batch [--stdin | --file <path>] [--summary | --no-summary] [--changed-since <ref>] [--group-by <mode>] [--compact]

Outcome aliases (thin wrappers around \`query --recipe <id>\`; pass-through flags):
  codemap dead-code         # query --recipe untested-and-dead
  codemap deprecated        # query --recipe deprecated-symbols
  codemap boundaries        # query --recipe boundary-violations
  codemap hotspots          # query --recipe fan-in
  codemap coverage-gaps     # query --recipe worst-covered-exports

Validate (compare on-disk SHA-256 to indexed hash):
  codemap validate [--json] [paths...]

Context (project snapshot envelope for any agent):
  codemap context [--compact] [--for "<intent>"] [--include-snippets]

Audit (structural drift — baseline snapshots or git ref):
  codemap audit [--baseline <prefix>] [--base <ref>] [--json] [--ci] ...

Agents:
  codemap agents init [--force] [--interactive|-i] [--mcp] [--targets <ids>] [--link-mode symlink|copy] [--git-hooks] [--no-git-hooks]
  codemap skill · codemap rule              # live full markdown (pointer protocol)

PR comment renderer (audit/SARIF → markdown summary):
  codemap pr-comment <file> [--shape audit|sarif] [--json]   # - for stdin

MCP server (Model Context Protocol — for agent hosts):
  codemap mcp                                        # stdio JSON-RPC (17 tools; watcher default-ON)
  # CLI parity: query batch, trace, explore, node, file, schema, symbols, context --include-snippets

HTTP server (for non-MCP consumers — CI scripts, curl, IDE plugins):
  codemap serve [--host 127.0.0.1] [--port 7878] [--token <secret>]   # watcher default-ON

Watch mode (long-running; keeps .codemap/index.db fresh on file edits):
  codemap watch [--debounce 250] [--quiet]
  codemap mcp · codemap serve                        # transport + watcher (default-ON since 2026-05)
  codemap mcp --no-watch · CODEMAP_WATCH=0           # opt out for one-shot calls

Targeted reads (precise lookup by symbol name):
  codemap show <name> [--kind <k>] [--in <path>] [--json]      # metadata: file:line + signature
  codemap snippet <name> [--kind <k>] [--in <path>] [--json]   # source text from disk + stale flag
  codemap file <path> [--compact]                              # per-file roll-up (MCP codemap://files twin)
  codemap schema [--compact]                                   # index DDL (MCP codemap://schema twin)
  codemap symbols <name> [--in <path>] [--compact]             # symbol lookup (MCP codemap://symbols twin)

Graph composers (MCP trace / explore / node twins):
  codemap trace --from <sym> --to <sym> [--max-depth N] [--via <b>] [--budget-chars N] [--compact]
  codemap explore <name>... [--depth N] [--kind <k>] [--budget-chars N] [--compact]
  codemap node <name> [--kind <k>] [--in <path>] [--include-snippets] [--budget-chars N] [--compact]

Impact analysis (graph walk for refactor blast-radius):
  codemap impact <target> [--direction up|down|both] [--depth N] [--via <b>] [--limit N] [--summary] [--json]

Affected tests (reverse dep walk → test files to run):
  codemap affected [--stdin] [--changed-since <ref>] [--json] [<path>...]

Apply (substrate-shaped fix executor; consumes the diff-json row contract):
  codemap apply <recipe-id> [--params k=v[,k=v]] [--dry-run] [--yes] [--json]

Coverage ingest (Istanbul JSON or LCOV from any test runner):
  codemap ingest-coverage <path> [--json]      # path = file or dir; format auto-detected

Other:
  codemap unlock [--force]     Remove stale cross-process index lock
  codemap version
  codemap --version, -V

Environment: CODEMAP_ROOT (same as --root), CODEMAP_STATE_DIR (same as --state-dir)

Options:
  --full          Full rebuild
  --state-dir DIR State directory for codemap-managed files (default .codemap/ under root)
  --performance   Print per-phase timing breakdown + top-10 slowest files
                  (full rebuild only)
  --help, -h      Show this help
`);
}

export function printVersion(): void {
  console.log(CODEMAP_VERSION);
}

/**
 * Paths for `codemap --files <paths...>` when `rest[0] === "--files"`; otherwise `null`.
 * Exits 1 on missing paths or flags where operands are required.
 */
export function parseIndexFilesArgs(rest: string[]): string[] | null {
  if (rest[0] !== "--files") return null;
  const files: string[] = [];
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("-")) {
      console.error(`codemap: unexpected option "${a}" after --files`);
      console.error("Run codemap --help for usage.");
      process.exit(1);
    }
    files.push(a);
  }
  if (files.length === 0) {
    console.error("codemap: --files requires at least one path");
    console.error("Run codemap --help for usage.");
    process.exit(1);
  }
  return files;
}

/**
 * Reject unknown flags/args for index mode before config or DB access.
 * Enforces `--files` as the first index option with at least one path.
 */
export function validateIndexModeArgs(rest: string[]): void {
  if (rest.length === 0) return;
  if (rest.includes("--files") && rest[0] !== "--files") {
    console.error("codemap: --files must be the first index option");
    console.error("Run codemap --help for usage.");
    process.exit(1);
  }
  if (rest[0] === "query") return;
  if (rest[0] === "validate") return;
  if (rest[0] === "context") return;
  if (rest[0] === "audit") return;
  if (rest[0] === "mcp") return;
  if (rest[0] === "serve") return;
  if (rest[0] === "watch") return;
  if (rest[0] === "show") return;
  if (rest[0] === "snippet") return;
  if (rest[0] === "impact") return;
  if (rest[0] === "affected") return;
  if (rest[0] === "apply") return;
  if (rest[0] === "ingest-coverage") return;
  if (rest[0] === "pr-comment") return;
  if (rest[0] === "trace") return;
  if (rest[0] === "explore") return;
  if (rest[0] === "node") return;
  if (rest[0] === "file") return;
  if (rest[0] === "schema") return;
  if (rest[0] === "symbols") return;
  if (rest[0] === "unlock") return;

  if (rest[0] === "agents") {
    if (rest[1] === "init") return;
    console.error(
      `codemap: unknown agents command "${rest[1] ?? "(missing)"}". Expected: codemap agents init [--force] [--interactive|-i] [--mcp] [--targets <ids>] [--link-mode symlink|copy] [--git-hooks] [--no-git-hooks]`,
    );
    process.exit(1);
  }

  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "--full" || a === "--performance" || a === "--with-fts") {
      i++;
      continue;
    }
    if (a === "--files") {
      i++;
      const start = i;
      while (i < rest.length && !rest[i].startsWith("-")) i++;
      if (i === start) {
        console.error("codemap: --files requires at least one path");
        console.error("Run codemap --help for usage.");
        process.exit(1);
      }
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`codemap: unknown option "${a}"`);
      console.error("Run codemap --help for usage.");
      process.exit(1);
    }
    console.error(`codemap: unexpected argument "${a}"`);
    console.error("Run codemap --help for usage.");
    process.exit(1);
  }
}

export function parseBootstrapArgs(argv: string[]) {
  const envRoot = process.env.CODEMAP_ROOT ?? process.env.CODEMAP_TEST_BENCH;
  let root = envRoot ? resolve(envRoot) : undefined;
  let configFile: string | undefined;
  let stateDir: string | undefined;
  let fts5Cli: boolean | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1]) {
      root = resolve(argv[++i]);
      continue;
    }
    if (a === "--config" && argv[i + 1]) {
      configFile = resolve(argv[++i]);
      continue;
    }
    if (a === "--state-dir" && argv[i + 1]) {
      stateDir = argv[++i];
      continue;
    }
    // Bootstrap-level (config-resolve needs it); also pushed to `rest` so
    // `validateIndexModeArgs` accepts it as a known flag.
    if (a === "--with-fts") {
      fts5Cli = true;
      rest.push(a);
      continue;
    }
    rest.push(a);
  }
  if (!root) root = process.cwd();
  // --state-dir wins over CODEMAP_STATE_DIR (precedence per plan §D7).
  if (!stateDir) stateDir = process.env.CODEMAP_STATE_DIR;
  return { root, configFile, stateDir, fts5Cli, rest };
}
