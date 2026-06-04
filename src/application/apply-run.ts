import { spawnSync } from "node:child_process";

import { closeDb, openDb } from "../db";
import { getApplyAutoApplyRecipes } from "../runtime";
import { parseUnifiedDiffToRows } from "./apply-diff-input";
import { applyDiffPayload } from "./apply-engine";
import type { ApplyJsonPayload } from "./apply-engine";
import { assertApplyAllowlist, assertApplyAutoFixable } from "./apply-policy";
import { queryRows } from "./index-engine";
import { getQueryRecipeParams, getQueryRecipeSql } from "./query-recipes";
import { resolveRecipeParams } from "./recipe-params";
import type { RecipeParamValues } from "./recipe-params";
import { runCodemapIndex } from "./run-index";

export type ApplyTerminatedBy = "empty" | "cap" | "conflicts" | "complete";

export interface ApplyRunResult {
  payload: ApplyJsonPayload;
  terminated_by?: ApplyTerminatedBy;
  passes?: number;
}

export interface ApplyFromRecipeOpts {
  projectRoot: string;
  recipeId: string;
  params: RecipeParamValues | undefined;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
}

export function runApplyFromRecipe(opts: ApplyFromRecipeOpts): ApplyRunResult {
  const allowErr = assertApplyAllowlist({
    recipeId: opts.recipeId,
    yes: opts.yes,
    force: opts.force,
    allowlist: getApplyAutoApplyRecipes(),
  });
  if (allowErr !== undefined) {
    throw new ApplyRunError(allowErr);
  }
  if (!opts.dryRun) {
    const fixErr = assertApplyAutoFixable({
      recipeId: opts.recipeId,
      force: opts.force,
    });
    if (fixErr !== undefined) throw new ApplyRunError(fixErr);
  }

  const sql = getQueryRecipeSql(opts.recipeId);
  if (sql === undefined) {
    throw new ApplyRunError(
      `codemap apply: unknown recipe "${opts.recipeId}".`,
    );
  }

  const resolved = resolveRecipeParams({
    recipeId: opts.recipeId,
    declared: getQueryRecipeParams(opts.recipeId),
    provided: opts.params,
  });
  if (!resolved.ok) throw new ApplyRunError(resolved.error);

  const rows = queryRows(sql, resolved.values);
  const payload = applyDiffPayload({
    rows: rows as Record<string, unknown>[],
    projectRoot: opts.projectRoot,
    dryRun: opts.dryRun,
  });
  return { payload };
}

export interface ApplyFromRowsOpts {
  projectRoot: string;
  rows: Record<string, unknown>[];
  dryRun: boolean;
}

export function runApplyFromRows(opts: ApplyFromRowsOpts): ApplyRunResult {
  const payload = applyDiffPayload({
    rows: opts.rows,
    projectRoot: opts.projectRoot,
    dryRun: opts.dryRun,
  });
  return { payload };
}

export function runApplyFromDiffText(opts: {
  projectRoot: string;
  diffText: string;
  dryRun: boolean;
}): ApplyRunResult {
  const rows = parseUnifiedDiffToRows(opts.diffText);
  return runApplyFromRows({
    projectRoot: opts.projectRoot,
    rows,
    dryRun: opts.dryRun,
  });
}

export async function runApplyUntilEmpty(opts: {
  projectRoot: string;
  recipeId: string;
  params: RecipeParamValues | undefined;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
  maxPasses: number;
}): Promise<ApplyRunResult> {
  let last: ApplyRunResult = {
    payload: {
      mode: opts.dryRun ? "dry-run" : "apply",
      applied: false,
      files: [],
      conflicts: [],
      summary: {
        files: 0,
        files_modified: 0,
        rows: 0,
        rows_applied: 0,
        conflicts: 0,
        files_with_conflicts: 0,
      },
    },
  };

  for (let pass = 1; pass <= opts.maxPasses; pass++) {
    last = runApplyFromRecipe({
      projectRoot: opts.projectRoot,
      recipeId: opts.recipeId,
      params: opts.params,
      dryRun: true,
      force: opts.force,
      yes: opts.yes,
    });
    if (last.payload.conflicts.length > 0) {
      return {
        payload: {
          ...last.payload,
          passes: pass,
          terminated_by: "conflicts",
        },
        passes: pass,
        terminated_by: "conflicts",
      };
    }
    if (last.payload.summary.rows === 0) {
      return {
        payload: {
          ...last.payload,
          passes: pass,
          terminated_by: "empty",
        },
        passes: pass,
        terminated_by: "empty",
      };
    }
    if (opts.dryRun) {
      return {
        payload: {
          ...last.payload,
          passes: pass,
          terminated_by: "complete",
        },
        passes: pass,
        terminated_by: "complete",
      };
    }

    last = runApplyFromRecipe({
      projectRoot: opts.projectRoot,
      recipeId: opts.recipeId,
      params: opts.params,
      dryRun: false,
      force: opts.force,
      yes: opts.yes,
    });
    if (last.payload.conflicts.length > 0) {
      return {
        payload: {
          ...last.payload,
          passes: pass,
          terminated_by: "conflicts",
        },
        passes: pass,
        terminated_by: "conflicts",
      };
    }
    const touched = last.payload.files.map((f) => f.file_path);
    if (touched.length > 0) {
      const db = openDb();
      try {
        await runCodemapIndex(db, {
          mode: "files",
          files: touched,
          quiet: true,
        });
      } finally {
        closeDb(db);
      }
    }
  }

  return {
    payload: {
      ...last.payload,
      passes: opts.maxPasses,
      terminated_by: "cap",
    },
    passes: opts.maxPasses,
    terminated_by: "cap",
  };
}

export function gitCommitAppliedFiles(opts: {
  projectRoot: string;
  message: string;
  filePaths: string[];
}): string | undefined {
  if (opts.filePaths.length === 0) return undefined;
  const add = spawnSync("git", ["add", "--", ...opts.filePaths], {
    cwd: opts.projectRoot,
    encoding: "utf8",
  });
  if (add.status !== 0) {
    return `git add failed: ${add.stderr || add.stdout || "unknown error"}`;
  }
  const commit = spawnSync("git", ["commit", "-m", opts.message], {
    cwd: opts.projectRoot,
    encoding: "utf8",
  });
  if (commit.status !== 0) {
    return `git commit failed: ${commit.stderr || commit.stdout || "unknown error"}`;
  }
  return undefined;
}

export class ApplyRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyRunError";
  }
}
