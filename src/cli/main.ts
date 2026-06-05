import {
  isOutcomeAlias,
  printOutcomeAliasHelp,
  resolveOutcomeAlias,
} from "./aliases.js";
import {
  parseBootstrapArgs,
  printCliUsage,
  printVersion,
  validateIndexModeArgs,
} from "./bootstrap.js";
import { emitJsonError } from "./emit-tool-result.js";

/**
 * CLI entry — only `./bootstrap` is loaded eagerly. Command bodies are
 * dynamically imported so `codemap --help` / `version` / `agents init` avoid
 * pulling in the indexer, parser, and workers.
 */
export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { root, configFile, stateDir, fts5Cli, rest } =
    parseBootstrapArgs(argv);

  if (rest[0] === "--help" || rest[0] === "-h") {
    printCliUsage();
    return;
  }

  if (rest[0] === "--version" || rest[0] === "-V" || rest[0] === "version") {
    printVersion();
    return;
  }

  // Project recipes live at `<state-dir>/recipes/<id>.sql`. Argv-parse-time
  // validation (`parseQueryRest` calls `getQueryRecipeSql` on `--recipe <id>` /
  // `--recipes-json` / `--print-sql`) runs BEFORE `bootstrapCodemap` and would
  // otherwise see `getProjectRoot()` throw → silent fallback to bundled-only.
  // Plumb the already-resolved root in so parser-side discovery works too.
  const { setQueryRecipesProjectRoot } =
    await import("../application/query-recipes.js");
  setQueryRecipesProjectRoot(root, stateDir);

  // Once-per-process stderr nag if the consumer's pointer files are out
  // of date relative to `EXPECTED_POINTER_VERSION`. Cure: `agents init
  // --force`. Polite to stdout (warning is stderr only).
  const { maybeWarnStalePointers } =
    await import("../application/agent-content.js");
  maybeWarnStalePointers(root);

  // Outcome aliases — rewrite `<alias>` to `query --recipe <id>` so the
  // existing query dispatch handles every flag pass-through. See ./aliases.ts.
  if (rest[0] && isOutcomeAlias(rest[0])) {
    if (rest.includes("--help") || rest.includes("-h")) {
      printOutcomeAliasHelp(rest[0]);
      return;
    }
    const rewritten = resolveOutcomeAlias(rest);
    if (rewritten) rest.splice(0, rest.length, ...rewritten);
  }

  if (rest[0] === "rename") {
    const { printRenameAliasHelp, resolveRenameAlias } =
      await import("./rename-alias.js");
    if ((rest[1] === "--help" || rest[1] === "-h") && rest.length === 2) {
      printRenameAliasHelp();
      return;
    }
    const renameResult = resolveRenameAlias(rest);
    if (renameResult?.kind === "error") {
      console.error(renameResult.message);
      process.exitCode = 1;
      return;
    }
    if (renameResult?.kind === "rewrite") {
      rest.splice(0, rest.length, ...renameResult.argv);
    }
  }

  if (rest[0] === "agents" && rest[1] === "init") {
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(`Usage: codemap agents init [--force] [--interactive|-i] [--mcp] [--targets <ids>] [--link-mode symlink|copy] [--git-hooks] [--no-git-hooks]

Copies bundled agent templates into .agents/ under the project root.
  --force        Refresh only files that ship in templates/agents (merge into rules/ & skills/)
  --interactive  Pick IDEs (Cursor, Copilot, Windsurf, …) and symlink vs copy
  --mcp          Write PM-aware MCP config (all defaults, or subset when --targets is set)
  --targets      Comma-separated integrations (cursor, copilot, claude-md, …); wires IDE mirrors
  --link-mode    symlink | copy — when --targets includes rule mirrors (default: symlink)
  --git-hooks    Install background incremental index hooks (post-commit, post-merge, post-checkout)
  --no-git-hooks Remove codemap blocks from git hooks
`);
      return;
    }
    const initRest = rest.slice(2);
    const { parseAgentsInitRest, runAgentsInitCmd } =
      await import("./cmd-agents.js");
    const parsed = parseAgentsInitRest(initRest);
    if (parsed.kind === "error") {
      console.error(parsed.message);
      console.error("Run codemap agents init --help for usage.");
      process.exit(1);
    }
    const ok = await runAgentsInitCmd({
      projectRoot: root,
      force: parsed.force,
      interactive: parsed.interactive,
      gitHooks: parsed.gitHooks,
      mcp: parsed.mcp,
      targets: parsed.targets,
      linkMode: parsed.linkMode,
    });
    if (!ok) process.exit(1);
    return;
  }

  if (rest[0] === "skill" || rest[0] === "rule") {
    const {
      parseAgentContentRest,
      printAgentContentCmdHelp,
      runAgentContentCmd,
    } = await import("./cmd-skill.js");
    const parsed = parseAgentContentRest(rest);
    if (parsed.kind === "help") {
      printAgentContentCmdHelp(parsed.verb);
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    runAgentContentCmd(parsed.verb);
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
      emitJsonError(parsed.message);
      return;
    }
    await runContextCmd({
      root,
      configFile,
      stateDir,
      compact: parsed.compact,
      intent: parsed.intent,
      includeSnippets: parsed.includeSnippets,
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
      stateDir,
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
      stateDir,
      name: parsed.name,
      kind: parsed.kindFilter,
      inPath: parsed.inPath,
      query: parsed.query,
      withFts: parsed.withFts,
      printSql: parsed.printSql,
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
      stateDir,
      name: parsed.name,
      kind: parsed.kindFilter,
      inPath: parsed.inPath,
      query: parsed.query,
      withFts: parsed.withFts,
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
    await runMcpCmd({
      root,
      configFile,
      stateDir,
      watch: parsed.watch,
      debounceMs: parsed.debounceMs,
    });
    return;
  }

  if (rest[0] === "watch") {
    const { parseWatchRest, printWatchCmdHelp, runWatchCmd } =
      await import("./cmd-watch.js");
    const parsed = parseWatchRest(rest);
    if (parsed.kind === "help") {
      printWatchCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runWatchCmd({
      root,
      configFile,
      stateDir,
      debounceMs: parsed.debounceMs,
      quiet: parsed.quiet,
    });
    return;
  }

  if (rest[0] === "serve") {
    const { parseServeRest, printServeCmdHelp, runServeCmd } =
      await import("./cmd-serve.js");
    const parsed = parseServeRest(rest);
    if (parsed.kind === "help") {
      printServeCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runServeCmd({
      root,
      configFile,
      stateDir,
      host: parsed.host,
      port: parsed.port,
      token: parsed.token,
      watch: parsed.watch,
      debounceMs: parsed.debounceMs,
    });
    return;
  }

  if (rest[0] === "impact") {
    const { parseImpactRest, printImpactCmdHelp, runImpactCmd } =
      await import("./cmd-impact.js");
    const parsed = parseImpactRest(rest);
    if (parsed.kind === "help") {
      printImpactCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runImpactCmd({
      root,
      configFile,
      stateDir,
      target: parsed.target,
      direction: parsed.direction,
      via: parsed.via,
      depth: parsed.depth,
      limit: parsed.limit,
      summary: parsed.summary,
      json: parsed.json,
    });
    return;
  }

  if (rest[0] === "affected") {
    const { parseAffectedRest, printAffectedCmdHelp, runAffectedFromParsed } =
      await import("./cmd-affected.js");
    const parsed = parseAffectedRest(rest);
    if (parsed.kind === "help") {
      printAffectedCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runAffectedFromParsed({
      root,
      configFile,
      stateDir,
      parsed,
    });
    return;
  }

  if (rest[0] === "apply") {
    const { parseApplyRest, printApplyCmdHelp, runApplyCmd } =
      await import("./cmd-apply.js");
    const parsed = parseApplyRest(rest);
    if (parsed.kind === "help") {
      printApplyCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runApplyCmd({
      root,
      configFile,
      stateDir,
      recipeId: parsed.recipeId,
      params: parsed.params,
      dryRun: parsed.dryRun,
      yes: parsed.yes,
      force: parsed.force,
      json: parsed.json,
      rowsPath: parsed.rowsPath,
      diffInputPath: parsed.diffInputPath,
      untilEmpty: parsed.untilEmpty,
      maxPasses: parsed.maxPasses,
      commitMessage: parsed.commitMessage,
    });
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
      stateDir,
      baselinePrefix: parsed.baselinePrefix,
      base: parsed.base,
      perDelta: parsed.perDelta,
      format: parsed.format,
      ci: parsed.ci,
      summary: parsed.summary,
      noIndex: parsed.noIndex,
    });
    return;
  }

  if (rest[0] === "pr-comment") {
    const { parsePrCommentRest, printPrCommentCmdHelp, runPrCommentCmd } =
      await import("./cmd-pr-comment.js");
    const parsed = parsePrCommentRest(rest);
    if (parsed.kind === "help") {
      printPrCommentCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runPrCommentCmd({
      root,
      configFile,
      stateDir,
      inputPath: parsed.inputPath as string,
      shape: parsed.shape,
      json: parsed.json === true,
    });
    return;
  }

  if (rest[0] === "ingest-coverage") {
    const {
      parseIngestCoverageRest,
      printIngestCoverageCmdHelp,
      runIngestCoverageCmd,
    } = await import("./cmd-ingest-coverage.js");
    const parsed = parseIngestCoverageRest(rest);
    if (parsed.kind === "help") {
      printIngestCoverageCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runIngestCoverageCmd({
      root,
      configFile,
      stateDir,
      path: parsed.path,
      json: parsed.json,
      runtime: parsed.runtime,
    });
    return;
  }

  if (rest[0] === "trace") {
    const { parseTraceRest, printTraceCmdHelp, runTraceCmd } =
      await import("./cmd-composers.js");
    const parsed = parseTraceRest(rest);
    if (parsed.kind === "help") {
      printTraceCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runTraceCmd({
      root,
      configFile,
      stateDir,
      from: parsed.from,
      to: parsed.to,
      maxDepth: parsed.maxDepth,
      via: parsed.via,
      budgetChars: parsed.budgetChars,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "explore") {
    const { parseExploreRest, printExploreCmdHelp, runExploreCmd } =
      await import("./cmd-composers.js");
    const parsed = parseExploreRest(rest);
    if (parsed.kind === "help") {
      printExploreCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runExploreCmd({
      root,
      configFile,
      stateDir,
      names: parsed.names,
      depth: parsed.depth,
      kindFilter: parsed.kindFilter,
      budgetChars: parsed.budgetChars,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "node") {
    const { parseNodeRest, printNodeCmdHelp, runNodeCmd } =
      await import("./cmd-composers.js");
    const parsed = parseNodeRest(rest);
    if (parsed.kind === "help") {
      printNodeCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runNodeCmd({
      root,
      configFile,
      stateDir,
      name: parsed.name,
      kindFilter: parsed.kindFilter,
      inPath: parsed.inPath,
      includeSnippets: parsed.includeSnippets,
      budgetChars: parsed.budgetChars,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "file") {
    const { parseFileRest, printFileCmdHelp, runFileCmd } =
      await import("./cmd-resource.js");
    const parsed = parseFileRest(rest);
    if (parsed.kind === "help") {
      printFileCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runFileCmd({
      root,
      configFile,
      stateDir,
      path: parsed.path,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "schema") {
    const { parseSchemaRest, printSchemaCmdHelp, runSchemaCmd } =
      await import("./cmd-resource.js");
    const parsed = parseSchemaRest(rest);
    if (parsed.kind === "help") {
      printSchemaCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runSchemaCmd({
      root,
      configFile,
      stateDir,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "symbols") {
    const { parseSymbolsRest, printSymbolsCmdHelp, runSymbolsCmd } =
      await import("./cmd-resource.js");
    const parsed = parseSymbolsRest(rest);
    if (parsed.kind === "help") {
      printSymbolsCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runSymbolsCmd({
      root,
      configFile,
      stateDir,
      name: parsed.name,
      inPath: parsed.inPath,
      compact: parsed.compact,
    });
    return;
  }

  if (rest[0] === "query" && rest[1] === "batch") {
    const { parseQueryBatchRest, printQueryBatchCmdHelp, runQueryBatchCmd } =
      await import("./cmd-query-batch.js");
    const parsed = parseQueryBatchRest(rest);
    if (parsed.kind === "help") {
      printQueryBatchCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      emitJsonError(parsed.message);
      return;
    }
    await runQueryBatchCmd({
      root,
      configFile,
      stateDir,
      stdin: parsed.stdin,
      filePath: parsed.filePath,
      summary: parsed.summary,
      changedSince: parsed.changedSince,
      groupBy: parsed.groupBy,
      compact: parsed.compact,
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
      printRecipesCatalogJson({ root, stateDir });
      return;
    }
    if (parsed.kind === "printRecipeSql") {
      if (!printRecipeSqlToStdout(parsed.id)) {
        process.exit(1);
      }
      return;
    }
    if (parsed.kind === "listBaselines") {
      await runListBaselinesCmd({
        root,
        configFile,
        stateDir,
        json: parsed.json,
      });
      return;
    }
    if (parsed.kind === "dropBaseline") {
      await runDropBaselineCmd({
        root,
        configFile,
        stateDir,
        name: parsed.name,
        json: parsed.json,
      });
      return;
    }
    await runQueryCmd({
      root,
      configFile,
      stateDir,
      sql: parsed.sql,
      json: parsed.json,
      format: parsed.format,
      ci: parsed.ci,
      summary: parsed.summary,
      changedSince: parsed.changedSince,
      recipeId: parsed.recipeId,
      groupBy: parsed.groupBy,
      saveBaseline: parsed.saveBaseline,
      baseline: parsed.baseline,
      recipeParams: parsed.recipeParams,
    });
    return;
  }

  if (rest[0] === "unlock") {
    const { parseUnlockRest, printUnlockCmdHelp, runUnlockCmd } =
      await import("./cmd-unlock.js");
    const parsed = parseUnlockRest(rest);
    if (parsed.kind === "help") {
      printUnlockCmdHelp();
      return;
    }
    if (parsed.kind === "error") {
      console.error(parsed.message);
      process.exit(1);
    }
    await runUnlockCmd({ root, stateDir, force: parsed.force });
    return;
  }

  const { runIndexCmd } = await import("./cmd-index.js");
  await runIndexCmd({ root, configFile, stateDir, fts5Cli, rest });
}
