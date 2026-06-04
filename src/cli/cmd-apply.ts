import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import type { ApplyJsonPayload } from "../application/apply-engine";
import {
  ApplyRunError,
  gitCommitAfterApplyIfEligible,
  runApplyFromDiffText,
  runApplyFromRecipe,
  runApplyFromRows,
  runApplyUntilEmpty,
} from "../application/apply-run";
import {
  getQueryRecipeParams,
  getQueryRecipeSql,
  listQueryRecipeIds,
} from "../application/query-recipes";
import {
  mergeParams,
  parseParamsCli,
  resolveRecipeParams,
} from "../application/recipe-params";
import type { RecipeParamValues } from "../application/recipe-params";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

interface ApplyOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  recipeId?: string;
  params: RecipeParamValues | undefined;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  json: boolean;
  rowsPath?: string;
  diffInputPath?: string;
  untilEmpty: boolean;
  maxPasses: number;
  commitMessage?: string;
}

/** Print `codemap apply` usage. */
export function printApplyCmdHelp(): void {
  console.log(`Usage:
  codemap apply <recipe-id> [--params k=v[,k=v]] [--dry-run] [--yes] [--force] [--json]
  codemap apply --rows -|<file.json> [--dry-run] [--yes] [--json]
  codemap apply --diff-input <file> [--dry-run] [--yes] [--json]

Apply diff hunks ({file_path, line_start, before_pattern, after_pattern}) to disk.

Flags:
  --params k=v[,k=v]   Parametrised recipes (recipe mode only).
  --rows -|<path>      JSON array of apply rows (stdin when -).
  --diff-input <file>  Unified diff → row contract.
  --dry-run            Phase-1 validate only.
  --yes                Skip TTY confirmation (required for non-TTY).
  --force              Bypass auto_fixable and apply.autoApplyRecipes gates.
  --until-empty        Fixpoint loop (recipe mode): apply → reindex → repeat.
  --max-passes N       Cap for --until-empty (default 10).
  --commit "<msg>"     git add touched files + commit after clean apply.
  --json               Structured envelope on stdout.
  --help, -h           This help.

Exit codes: 0 clean; 1 conflicts or error.
`);
}

/** Parse argv after bootstrap split. `rest[0]` must be `"apply"`. */
export function parseApplyRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      recipeId?: string;
      params: RecipeParamValues | undefined;
      dryRun: boolean;
      yes: boolean;
      force: boolean;
      json: boolean;
      rowsPath?: string;
      diffInputPath?: string;
      untilEmpty: boolean;
      maxPasses: number;
      commitMessage?: string;
    } {
  if (rest[0] !== "apply") {
    throw new Error("parseApplyRest: expected apply");
  }

  let recipeId: string | undefined;
  let params: RecipeParamValues | undefined;
  let dryRun = false;
  let yes = false;
  let force = false;
  let json = false;
  let rowsPath: string | undefined;
  let diffInputPath: string | undefined;
  let untilEmpty = false;
  let maxPasses = 10;
  let commitMessage: string | undefined;

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") return { kind: "help" };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--yes") {
      yes = true;
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--until-empty") {
      untilEmpty = true;
      continue;
    }
    if (a === "--rows") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap apply: "--rows" requires - or a file path.`,
        };
      }
      rowsPath = next;
      i++;
      continue;
    }
    if (a === "--diff-input") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap apply: "--diff-input" requires a file path.`,
        };
      }
      diffInputPath = next;
      i++;
      continue;
    }
    if (a === "--max-passes") {
      const next = rest[i + 1];
      if (next === undefined || !/^\d+$/.test(next)) {
        return {
          kind: "error",
          message: `codemap apply: "--max-passes" requires a positive integer.`,
        };
      }
      maxPasses = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (a === "--commit") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap apply: "--commit" requires a message string.`,
        };
      }
      commitMessage = next;
      i++;
      continue;
    }
    if (a === "--params") {
      const next = rest[i + 1];
      if (next === undefined) {
        return {
          kind: "error",
          message: `codemap apply: "--params" requires a value (k=v[,k=v]).`,
        };
      }
      params = mergeParams(params, parseParamsCli(next));
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap apply: unknown option "${a}". Run \`codemap apply --help\` for usage.`,
      };
    }
    if (recipeId !== undefined) {
      return {
        kind: "error",
        message: `codemap apply: unexpected extra argument "${a}".`,
      };
    }
    recipeId = a;
  }

  const modeCount =
    (recipeId !== undefined ? 1 : 0) +
    (rowsPath !== undefined ? 1 : 0) +
    (diffInputPath !== undefined ? 1 : 0);
  if (modeCount === 0) {
    return {
      kind: "error",
      message: `codemap apply: pass <recipe-id>, --rows, or --diff-input. Run \`codemap apply --help\`.`,
    };
  }
  if (modeCount > 1) {
    return {
      kind: "error",
      message: `codemap apply: choose one of <recipe-id>, --rows, or --diff-input.`,
    };
  }
  if (untilEmpty && recipeId === undefined) {
    return {
      kind: "error",
      message: `codemap apply: --until-empty requires a <recipe-id>.`,
    };
  }
  if (dryRun && yes) {
    return {
      kind: "error",
      message: `codemap apply: --dry-run and --yes are mutually exclusive.`,
    };
  }

  return {
    kind: "run",
    recipeId,
    params,
    dryRun,
    yes,
    force,
    json,
    rowsPath,
    diffInputPath,
    untilEmpty,
    maxPasses,
    commitMessage,
  };
}

/**
 * Run `codemap apply`. Sets `process.exitCode = 1` on failure (no `process.exit`).
 */
export async function runApplyCmd(opts: ApplyOpts): Promise<void> {
  try {
    const parsed = opts;
    await bootstrapCodemap(opts);
    const projectRoot = getProjectRoot();

    if (parsed.recipeId !== undefined) {
      await runRecipeApply({
        ...parsed,
        recipeId: parsed.recipeId,
        projectRoot,
      });
      return;
    }

    if (parsed.rowsPath !== undefined) {
      await runRowsApply({
        rowsPath: parsed.rowsPath,
        dryRun: parsed.dryRun,
        yes: parsed.yes,
        json: parsed.json,
        commitMessage: parsed.commitMessage,
        projectRoot,
      });
      return;
    }

    if (parsed.diffInputPath !== undefined) {
      await runDiffApply({
        diffInputPath: parsed.diffInputPath,
        dryRun: parsed.dryRun,
        yes: parsed.yes,
        json: parsed.json,
        commitMessage: parsed.commitMessage,
        projectRoot,
      });
      return;
    }
  } catch (err) {
    const msg =
      err instanceof ApplyRunError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    emitError(msg, opts.json);
  }
}

async function runRecipeApply(opts: {
  recipeId: string;
  params: RecipeParamValues | undefined;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  json: boolean;
  untilEmpty: boolean;
  maxPasses: number;
  commitMessage?: string;
  projectRoot: string;
}): Promise<void> {
  if (getQueryRecipeSql(opts.recipeId) === undefined) {
    const known = listQueryRecipeIds().join(", ");
    emitError(
      `codemap apply: unknown recipe "${opts.recipeId}". Known: ${known}.`,
      opts.json,
    );
    return;
  }

  const resolved = resolveRecipeParams({
    recipeId: opts.recipeId,
    declared: getQueryRecipeParams(opts.recipeId),
    provided: opts.params,
  });
  if (!resolved.ok) {
    emitError(resolved.error, opts.json);
    return;
  }

  const canPrompt =
    process.stdin.isTTY === true && process.stderr.isTTY === true;
  if (!canPrompt && !opts.yes && !opts.dryRun) {
    emitError(
      `codemap apply: this verb writes files. Pass --yes for non-interactive runs, or --dry-run for preview.`,
      opts.json,
    );
    return;
  }

  if (opts.untilEmpty) {
    const loopResult = await runApplyUntilEmpty({
      projectRoot: opts.projectRoot,
      recipeId: opts.recipeId,
      params: opts.params,
      dryRun: opts.dryRun,
      force: opts.force,
      yes: opts.yes,
      maxPasses: opts.maxPasses,
    });
    await finishApply(loopResult.payload, {
      recipeId: opts.recipeId,
      dryRun: opts.dryRun,
      json: opts.json,
      commitMessage: opts.commitMessage,
      projectRoot: opts.projectRoot,
    });
    return;
  }

  if (opts.dryRun || opts.yes) {
    const { payload } = runApplyFromRecipe({
      projectRoot: opts.projectRoot,
      recipeId: opts.recipeId,
      params: opts.params,
      dryRun: opts.dryRun,
      force: opts.force,
      yes: opts.yes,
    });
    await finishApply(payload, opts);
    return;
  }

  const preview = runApplyFromRecipe({
    projectRoot: opts.projectRoot,
    recipeId: opts.recipeId,
    params: opts.params,
    dryRun: true,
    force: opts.force,
    yes: false,
  }).payload;

  if (preview.conflicts.length > 0 || preview.files.length === 0) {
    emitResult(preview, opts);
    return;
  }

  printPromptSummary(preview, opts.recipeId);
  const proceed = await promptYesNo();
  if (!proceed) {
    if (opts.json) {
      emitResult(preview, opts);
    } else {
      console.log(`apply ${opts.recipeId}: aborted by user; no files written.`);
    }
    return;
  }

  const { payload } = runApplyFromRecipe({
    projectRoot: opts.projectRoot,
    recipeId: opts.recipeId,
    params: opts.params,
    dryRun: false,
    force: opts.force,
    yes: true,
  });
  await finishApply(payload, opts);
}

async function runRowsApply(opts: {
  rowsPath: string;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  commitMessage?: string;
  projectRoot: string;
}): Promise<void> {
  const text =
    opts.rowsPath === "-"
      ? readFileSync(0, "utf8")
      : readFileSync(opts.rowsPath, "utf8");
  let rows: unknown;
  try {
    rows = JSON.parse(text) as unknown;
  } catch {
    emitError(`codemap apply: --rows input is not valid JSON.`, opts.json);
    return;
  }
  if (!Array.isArray(rows)) {
    emitError(`codemap apply: --rows JSON must be an array.`, opts.json);
    return;
  }

  const canPrompt =
    process.stdin.isTTY === true && process.stderr.isTTY === true;
  if (!canPrompt && !opts.yes && !opts.dryRun) {
    emitError(
      `codemap apply: pass --yes for non-interactive --rows apply.`,
      opts.json,
    );
    return;
  }

  const { payload } = runApplyFromRows({
    projectRoot: opts.projectRoot,
    rows: rows as Record<string, unknown>[],
    dryRun: opts.dryRun,
  });
  await finishApply(payload, {
    recipeId: "--rows",
    dryRun: opts.dryRun,
    json: opts.json,
    commitMessage: opts.commitMessage,
    projectRoot: opts.projectRoot,
  });
}

async function runDiffApply(opts: {
  diffInputPath: string;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  commitMessage?: string;
  projectRoot: string;
}): Promise<void> {
  const diffText = readFileSync(opts.diffInputPath, "utf8");
  const canPrompt =
    process.stdin.isTTY === true && process.stderr.isTTY === true;
  if (!canPrompt && !opts.yes && !opts.dryRun) {
    emitError(
      `codemap apply: pass --yes for non-interactive --diff-input apply.`,
      opts.json,
    );
    return;
  }
  const { payload } = runApplyFromDiffText({
    projectRoot: opts.projectRoot,
    diffText,
    dryRun: opts.dryRun,
  });
  await finishApply(payload, {
    recipeId: "--diff-input",
    dryRun: opts.dryRun,
    json: opts.json,
    commitMessage: opts.commitMessage,
    projectRoot: opts.projectRoot,
  });
}

async function finishApply(
  payload: ApplyJsonPayload,
  opts: {
    recipeId: string;
    dryRun: boolean;
    json: boolean;
    commitMessage?: string;
    projectRoot: string;
  },
): Promise<void> {
  if (opts.commitMessage !== undefined) {
    const gitErr = gitCommitAfterApplyIfEligible({
      projectRoot: opts.projectRoot,
      message: opts.commitMessage,
      payload,
    });
    if (gitErr !== undefined) {
      emitError(gitErr, opts.json);
      return;
    }
  }
  emitResult(payload, opts);
}

function emitResult(
  result: ApplyJsonPayload,
  opts: { recipeId: string; dryRun: boolean; json: boolean },
): void {
  if (opts.json) {
    console.log(JSON.stringify(result));
  } else {
    renderTerminal(result, opts.recipeId, opts.dryRun);
  }
  if (result.conflicts.length > 0) {
    process.exitCode = 1;
  }
}

function renderTerminal(
  result: ApplyJsonPayload,
  recipeId: string,
  dryRun: boolean,
): void {
  if (result.conflicts.length > 0) {
    console.log(
      `apply ${recipeId}: aborted (${result.summary.conflicts} conflicts in ${result.summary.files_with_conflicts} files); see --json for details`,
    );
    return;
  }
  if (result.terminated_by !== undefined) {
    console.log(
      `apply ${recipeId}: loop finished (${result.passes ?? "?"} passes, terminated_by=${result.terminated_by}).`,
    );
  }
  if (dryRun) {
    if (result.files.length === 0) {
      console.log(`apply ${recipeId} --dry-run: no rows applicable.`);
      return;
    }
    console.log(
      `apply ${recipeId} --dry-run: would modify ${result.summary.files} files (${result.summary.rows} rows).`,
    );
    return;
  }
  if (!result.applied) {
    console.log(`apply ${recipeId}: no rows applicable.`);
    return;
  }
  console.log(
    `apply ${recipeId}: modified ${result.summary.files_modified} files, applied ${result.summary.rows_applied} rows.`,
  );
}

function printPromptSummary(preview: ApplyJsonPayload, recipeId: string): void {
  console.error(
    `apply ${recipeId}: ${preview.summary.files} files, ${preview.summary.rows} rows`,
  );
  for (const file of preview.files) {
    console.error(`  - ${file.file_path} (${file.rows_applied} rows)`);
  }
  console.error("");
}

async function promptYesNo(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("Proceed? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function emitError(message: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
