import {
  parseBootstrapArgs,
  printCliUsage,
  printVersion,
  validateIndexModeArgs,
} from "./bootstrap.js";

/**
 * CLI entry — only `./bootstrap` is loaded eagerly. Command bodies are
 * dynamically imported so `codemap --help` / `version` / `agents init` avoid
 * pulling in the indexer, parser, and workers.
 */
export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { root, configFile, rest } = parseBootstrapArgs(argv);

  if (rest[0] === "--help" || rest[0] === "-h") {
    printCliUsage();
    return;
  }

  if (rest[0] === "--version" || rest[0] === "-V" || rest[0] === "version") {
    printVersion();
    return;
  }

  if (rest[0] === "agents" && rest[1] === "init") {
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(`Usage: codemap agents init [--force]

Copies bundled agent templates into .agents/ under the project root.
Use --force to overwrite an existing .agents/ directory.
`);
      return;
    }
    const { runAgentsInitCmd } = await import("./cmd-agents.js");
    const ok = runAgentsInitCmd({
      projectRoot: root,
      force: rest.includes("--force"),
    });
    if (!ok) process.exit(1);
    return;
  }

  validateIndexModeArgs(rest);

  if (rest[0] === "query" && rest[1]) {
    if (rest[1] === "--help" || rest[1] === "-h") {
      console.log(`Usage: codemap query "<SQL>"

Runs read-only SQL against .codemap.db (after at least one successful index run).
Example: codemap query "SELECT name, file_path FROM symbols LIMIT 10"
`);
      return;
    }
    const { runQueryCmd } = await import("./cmd-query.js");
    await runQueryCmd({
      root,
      configFile,
      sql: rest.slice(1).join(" "),
    });
    return;
  }

  const { runIndexCmd } = await import("./cmd-index.js");
  await runIndexCmd({ root, configFile, rest });
}
