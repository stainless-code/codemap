import { createInterface } from "node:readline/promises";

import { applyDiffPayload } from "../application/apply-engine";
import type { ApplyJsonPayload } from "../application/apply-engine";
import { queryRows } from "../application/index-engine";
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
  recipeId: string;
  params: RecipeParamValues | undefined;
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

/** Print `codemap apply` usage. */
export function printApplyCmdHelp(): void {
  console.log(`Usage: codemap apply <recipe-id> [--params k=v[,k=v]] [--dry-run] [--yes] [--json]

Apply the diff hunks a recipe describes (one per row of {file_path,
line_start, before_pattern, after_pattern}) to disk. The recipe SQL is
the synthesis surface; codemap is the executor — substrate, not verdict.

Args:
  <recipe-id>        Same ids \`codemap query --recipe\` accepts. The recipe
                     must produce rows with the diff-json column shape.

Flags:
  --params k=v[,k=v] Bind values for parametrised recipes. Repeatable;
                     last value wins on duplicate keys.
  --dry-run          Preview only — phase-1 validates against current disk;
                     no file is written. Mutually exclusive with --yes.
  --yes              Skip the TTY confirmation prompt. Required for non-TTY
                     contexts (CI, agents, MCP).
  --json             Emit the structured envelope (one JSON object) on
                     stdout. Errors emit \`{"error":"..."}\`.
  --help, -h         Show this help.

Output (JSON, all cases):
  { "mode": "dry-run" | "apply", "applied": <bool>,
    "files": [ {file_path, rows_applied, warnings?}, ... ],
    "conflicts": [ {file_path, line_start, before_pattern,
                    actual_at_line, reason}, ... ],
    "summary": { files, files_modified, rows, rows_applied,
                 conflicts, files_with_conflicts } }

Exit codes:
  0   Clean apply (or clean dry-run with zero conflicts).
  1   Any conflicts detected; phase 2 aborted (or any failure).

Examples:
  codemap apply rename-preview --params old=foo,new=bar --dry-run
  codemap apply rename-preview --params old=foo,new=bar --yes
  codemap apply rename-preview --params old=foo,new=bar --yes --json
`);
}

/** Parse argv after bootstrap split. `rest[0]` must be `"apply"`. */
export function parseApplyRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      recipeId: string;
      params: RecipeParamValues | undefined;
      dryRun: boolean;
      yes: boolean;
      json: boolean;
    } {
  if (rest[0] !== "apply") {
    throw new Error("parseApplyRest: expected apply");
  }

  let recipeId: string | undefined;
  let params: RecipeParamValues | undefined;
  let dryRun = false;
  let yes = false;
  let json = false;

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
        message: `codemap apply: unexpected extra argument "${a}". Pass exactly one <recipe-id>.`,
      };
    }
    recipeId = a;
  }

  if (recipeId === undefined) {
    return {
      kind: "error",
      message: `codemap apply: missing <recipe-id>. Run \`codemap apply --help\` for usage.`,
    };
  }
  if (dryRun && yes) {
    return {
      kind: "error",
      message: `codemap apply: --dry-run and --yes are mutually exclusive (--dry-run never writes).`,
    };
  }

  return { kind: "run", recipeId, params, dryRun, yes, json };
}

/**
 * Run `codemap apply <recipe-id>`. Bootstraps, resolves the recipe SQL,
 * executes it, validates rows against disk, and either previews or writes
 * per Q6's TTY/`--yes` gate. Sets `process.exitCode = 1` on any failure or
 * conflicts (no `process.exit`) so piped stdout isn't truncated.
 */
export async function runApplyCmd(opts: ApplyOpts): Promise<void> {
  try {
    const sql = getQueryRecipeSql(opts.recipeId);
    if (sql === undefined) {
      const known = listQueryRecipeIds().join(", ");
      emitError(
        `codemap apply: unknown recipe "${opts.recipeId}". Known: ${known}.`,
        opts.json,
      );
      return;
    }

    await bootstrapCodemap(opts);

    const resolved = resolveRecipeParams({
      recipeId: opts.recipeId,
      declared: getQueryRecipeParams(opts.recipeId),
      provided: opts.params,
    });
    if (!resolved.ok) {
      emitError(resolved.error, opts.json);
      return;
    }

    let rows: unknown[];
    try {
      rows = queryRows(sql, resolved.values);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitError(
        `codemap apply: recipe SQL execution failed — ${msg}`,
        opts.json,
      );
      return;
    }

    const projectRoot = getProjectRoot();
    const isTTY = process.stdout.isTTY === true;

    // Q6 (a): non-TTY without --yes / --dry-run is rejected.
    if (!isTTY && !opts.yes && !opts.dryRun) {
      emitError(
        `codemap apply: this verb writes files. Pass --yes for non-interactive runs, or --dry-run for preview.`,
        opts.json,
      );
      return;
    }

    if (opts.dryRun || opts.yes) {
      const result = applyDiffPayload({
        rows: rows as Record<string, unknown>[],
        projectRoot,
        dryRun: opts.dryRun,
      });
      emitResult(result, opts);
      return;
    }

    // Interactive path: dry-run preview → prompt → apply. Phase-1 runs
    // twice on accept (preview + the apply call's own pass) — two FS reads
    // per pending file; fine for a non-hot CLI path.
    const preview = applyDiffPayload({
      rows: rows as Record<string, unknown>[],
      projectRoot,
      dryRun: true,
    });
    if (preview.conflicts.length > 0 || preview.files.length === 0) {
      emitResult(preview, opts);
      return;
    }

    printPromptSummary(preview, opts.recipeId, rows);
    const proceed = await promptYesNo();
    if (!proceed) {
      console.error("apply: aborted by user.");
      emitResult(preview, opts);
      return;
    }

    const applyResult = applyDiffPayload({
      rows: rows as Record<string, unknown>[],
      projectRoot,
      dryRun: false,
    });
    emitResult(applyResult, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitError(msg, opts.json);
  }
}

function emitResult(result: ApplyJsonPayload, opts: ApplyOpts): void {
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
  if (dryRun) {
    if (result.files.length === 0) {
      console.log(`apply ${recipeId} --dry-run: no rows applicable.`);
      return;
    }
    console.log(
      `apply ${recipeId} --dry-run: would modify ${result.summary.files} files (${result.summary.rows} rows). Re-run without --dry-run to apply.`,
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

function printPromptSummary(
  preview: ApplyJsonPayload,
  recipeId: string,
  rows: unknown[],
): void {
  // `files[].rows_applied` is 0 in dry-run (Q5); recount from input rows.
  const perFile = new Map<string, number>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const fp = (row as Record<string, unknown>)["file_path"];
    if (typeof fp !== "string") continue;
    perFile.set(fp, (perFile.get(fp) ?? 0) + 1);
  }
  console.error(
    `apply ${recipeId}: ${preview.summary.files} files, ${preview.summary.rows} rows`,
  );
  for (const file of preview.files) {
    const n = perFile.get(file.file_path) ?? 0;
    console.error(`  - ${file.file_path} (${n} ${n === 1 ? "row" : "rows"})`);
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
