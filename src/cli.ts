import { extname, resolve } from "node:path";

import { runAgentsInit } from "./agents-init";
import { printQueryResult, VALID_EXTENSIONS } from "./application/index-engine";
import { runCodemapIndex } from "./application/run-index";
import { loadUserConfig, resolveCodemapConfig } from "./config";
import { closeDb, openDb } from "./db";
import { configureResolver } from "./resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "./runtime";

/** Printed for `codemap --help` / `-h` (must run before config or DB access). */
export function printCliUsage(): void {
  console.log(`Usage: codemap [options] [command]

Index (default): update .codemap.db for the project root (\`--root\` or cwd).
  codemap [--root DIR] [--config FILE] [--full]
  codemap [--root DIR] [--config FILE] --files <paths...>

Query:
  codemap query "<SQL>"

Agents:
  codemap agents init [--force]

Environment: CODEMAP_ROOT (same as --root)

Options:
  --full          Full rebuild
  --help, -h      Show this help
`);
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

export async function main() {
  const argv = process.argv.slice(2);
  const { root, configFile, rest } = parseBootstrapArgs(argv);

  if (rest[0] === "--help" || rest[0] === "-h") {
    printCliUsage();
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
    const ok = runAgentsInit({
      projectRoot: root,
      force: rest.includes("--force"),
    });
    if (!ok) process.exit(1);
    return;
  }

  const user = await loadUserConfig(root, configFile);
  initCodemap(resolveCodemapConfig(root, user));
  configureResolver(getProjectRoot(), getTsconfigPath());

  const args = rest;

  if (args[0] === "query" && args[1]) {
    if (args[1] === "--help" || args[1] === "-h") {
      console.log(`Usage: codemap query "<SQL>"

Runs read-only SQL against .codemap.db (after at least one successful index run).
Example: codemap query "SELECT name, file_path FROM symbols LIMIT 10"
`);
      return;
    }
    printQueryResult(args.slice(1).join(" "));
    return;
  }

  const db = openDb();
  try {
    if (args[0] === "--files" && args.length > 1) {
      const targetFiles = args.slice(1).filter((f) => {
        const ext = extname(f);
        if (!VALID_EXTENSIONS.has(ext)) {
          console.warn(`  Skipping ${f}: unsupported extension "${ext}"`);
          return false;
        }
        return true;
      });
      if (targetFiles.length > 0) {
        await runCodemapIndex(db, {
          mode: "files",
          files: targetFiles,
        });
      }
    } else {
      const fullRebuild = args.includes("--full");
      await runCodemapIndex(db, {
        mode: fullRebuild ? "full" : "incremental",
      });
    }
  } finally {
    closeDb(db);
  }
}
