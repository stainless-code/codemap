import { extname, resolve } from "node:path";

import { runAgentsInit } from "./agents-init";
import { printQueryResult, VALID_EXTENSIONS } from "./application/index-engine";
import { runCodemapIndex } from "./application/run-index";
import { loadUserConfig, resolveCodemapConfig } from "./config";
import { closeDb, openDb } from "./db";
import { configureResolver } from "./resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "./runtime";

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

  if (rest[0] === "agents" && rest[1] === "init") {
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
