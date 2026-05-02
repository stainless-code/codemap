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
      console.log(`Usage: codemap agents init [--force] [--interactive|-i]

Copies bundled agent templates into .agents/ under the project root.
  --force        Refresh only files that ship in templates/agents (merge into rules/ & skills/)
  --interactive  Pick IDEs (Cursor, Copilot, Windsurf, …) and symlink vs copy
`);
      return;
    }
    const initRest = rest.slice(2);
    const knownInit = new Set([
      "--force",
      "--interactive",
      "-i",
      "--help",
      "-h",
    ]);
    for (const a of initRest) {
      if (knownInit.has(a)) {
        continue;
      }
      if (a.startsWith("-")) {
        console.error(`codemap: unknown option "${a}"`);
      } else {
        console.error(`codemap: unexpected argument "${a}"`);
      }
      console.error("Run codemap agents init --help for usage.");
      process.exit(1);
    }
    const { runAgentsInitCmd } = await import("./cmd-agents.js");
    const ok = await runAgentsInitCmd({
      projectRoot: root,
      force: rest.includes("--force"),
      interactive: rest.includes("--interactive") || rest.includes("-i"),
    });
    if (!ok) process.exit(1);
    return;
  }

  validateIndexModeArgs(rest);

  if (rest[0] === "context") {
    const { parseContextRest, printContextCmdHelp, runContextCmd } =
      await import("./cmd-context.js");
    const parsed = parseContextRest(rest);
    if (parsed.kind === "help") {
      printContextCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runContextCmd({
      root,
      configFile,
      compact: parsed.compact,
      intent: parsed.intent,
    });
    return;
  }

  if (rest[0] === "validate") {
    const { parseValidateRest, printValidateCmdHelp, runValidateCmd } =
      await import("./cmd-validate.js");
    const parsed = parseValidateRest(rest);
    if (parsed.kind === "help") {
      printValidateCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runValidateCmd({
      root,
      configFile,
      paths: parsed.paths,
      json: parsed.json,
    });
    return;
  }

  if (rest[0] === "show") {
    const { parseShowRest, printShowCmdHelp, runShowCmd } =
      await import("./cmd-show.js");
    const parsed = parseShowRest(rest);
    if (parsed.kind === "help") {
      printShowCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runShowCmd({
      root,
      configFile,
      name: parsed.name,
      kind: parsed.kindFilter,
      inPath: parsed.inPath,
      json: parsed.json,
    });
    return;
  }

  if (rest[0] === "snippet") {
    const { parseSnippetRest, printSnippetCmdHelp, runSnippetCmd } =
      await import("./cmd-snippet.js");
    const parsed = parseSnippetRest(rest);
    if (parsed.kind === "help") {
      printSnippetCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runSnippetCmd({
      root,
      configFile,
      name: parsed.name,
      kind: parsed.kindFilter,
      inPath: parsed.inPath,
      json: parsed.json,
    });
    return;
  }

  if (rest[0] === "mcp") {
    const { parseMcpRest, printMcpCmdHelp, runMcpCmd } =
      await import("./cmd-mcp.js");
    const parsed = parseMcpRest(rest);
    if (parsed.kind === "help") {
      printMcpCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runMcpCmd({ root, configFile });
    return;
  }

  if (rest[0] === "audit") {
    const { parseAuditRest, printAuditCmdHelp, runAuditCmd } =
      await import("./cmd-audit.js");
    const parsed = parseAuditRest(rest);
    if (parsed.kind === "help") {
      printAuditCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runAuditCmd({
      root,
      configFile,
      baselinePrefix: parsed.baselinePrefix,
      perDelta: parsed.perDelta,
      json: parsed.json,
      summary: parsed.summary,
      noIndex: parsed.noIndex,
    });
    return;
  }

  if (rest[0] === "query") {
    const {
      parseQueryRest,
      printQueryCmdHelp,
      printRecipesCatalogJson,
      printRecipeSqlToStdout,
      runDropBaselineCmd,
      runListBaselinesCmd,
      runQueryCmd,
    } = await import("./cmd-query.js");
    const parsed = parseQueryRest(rest);
    if (parsed.kind === "help") {
      printQueryCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    if (parsed.kind === "recipesCatalog") {
      printRecipesCatalogJson();
      return;
    }
    if (parsed.kind === "printRecipeSql") {
      if (!printRecipeSqlToStdout(parsed.id)) {
        process.exit(1);
      }
      return;
    }
    if (parsed.kind === "listBaselines") {
      await runListBaselinesCmd({ root, configFile, json: parsed.json });
      return;
    }
    if (parsed.kind === "dropBaseline") {
      await runDropBaselineCmd({
        root,
        configFile,
        name: parsed.name,
        json: parsed.json,
      });
      return;
    }
    await runQueryCmd({
      root,
      configFile,
      sql: parsed.sql,
      json: parsed.json,
      format: parsed.format,
      summary: parsed.summary,
      changedSince: parsed.changedSince,
      recipeId: parsed.recipeId,
      groupBy: parsed.groupBy,
      saveBaseline: parsed.saveBaseline,
      baseline: parsed.baseline,
    });
    return;
  }

  const { runIndexCmd } = await import("./cmd-index.js");
  await runIndexCmd({ root, configFile, rest });
}
