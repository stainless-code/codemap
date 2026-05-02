import { resolve } from "node:path";

import { CODEMAP_VERSION } from "../version";

/**
 * Printed for `codemap --help` / `-h` (must run before config or DB access).
 */
export function printCliUsage(): void {
  console.log(`Usage: codemap [options] [command]

Index (default): update .codemap.db for the project root (\`--root\` or cwd).
  codemap [--root DIR] [--config FILE] [--full]
  codemap [--root DIR] [--config FILE] --files <paths...>

Query:
  codemap query [--json] "<SQL>"
  codemap query [--json] --recipe <id>

Validate (compare on-disk SHA-256 to indexed hash):
  codemap validate [--json] [paths...]

Context (project snapshot envelope for any agent):
  codemap context [--compact] [--for "<intent>"]

Agents:
  codemap agents init [--force] [--interactive|-i]

MCP server (Model Context Protocol — for agent hosts):
  codemap mcp                                        # stdio JSON-RPC, one tool per CLI verb

Targeted reads (precise lookup by symbol name):
  codemap show <name> [--kind <k>] [--in <path>] [--json]      # metadata: file:line + signature
  codemap snippet <name> [--kind <k>] [--in <path>] [--json]   # source text from disk + stale flag

Other:
  codemap version
  codemap --version, -V

Environment: CODEMAP_ROOT (same as --root)

Options:
  --full          Full rebuild
  --performance   Print per-phase timing breakdown + top-10 slowest files
                  (full rebuild only)
  --help, -h      Show this help
`);
}

export function printVersion(): void {
  console.log(CODEMAP_VERSION);
}

/**
 * Reject unknown flags/args for index mode before config or DB access.
 * Prevents typos like `--versiond` from falling through to incremental index.
 */
export function validateIndexModeArgs(rest: string[]): void {
  if (rest.length === 0) return;
  if (rest[0] === "query") return;
  if (rest[0] === "validate") return;
  if (rest[0] === "context") return;
  if (rest[0] === "audit") return;
  if (rest[0] === "mcp") return;
  if (rest[0] === "serve") return;
  if (rest[0] === "show") return;
  if (rest[0] === "snippet") return;

  if (rest[0] === "agents") {
    if (rest[1] === "init") return;
    console.error(
      `codemap: unknown agents command "${rest[1] ?? "(missing)"}". Expected: codemap agents init [--force] [--interactive|-i]`,
    );
    process.exit(1);
  }

  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "--full" || a === "--performance") {
      i++;
      continue;
    }
    if (a === "--files") {
      i++;
      while (i < rest.length && !rest[i].startsWith("-")) i++;
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
    rest.push(a);
  }
  if (!root) root = process.cwd();
  return { root, configFile, rest };
}
