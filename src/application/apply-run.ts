import { spawnSync } from "node:child_process";

import { closeDb, openDb } from "../db";
import { getApplyAutoApplyRecipes } from "../runtime";
import { parseUnifiedDiffToRows } from "./apply-diff-input";
import { applyDiffPayload } from "./apply-engine";
import type { ApplyFile, ApplyJsonPayload } from "./apply-engine";
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

function mergeApplyFiles(
  accumulated: Map<string, ApplyFile>,
  incoming: ApplyFile[],
): void {
  for (const f of incoming) {
    const prev = accumulated.get(f.file_path);
    if (prev === undefined) {
      accumulated.set(f.file_path, { ...f });
      continue;
    }
    accumulated.set(f.file_path, {
      file_path: f.file_path,
      rows_applied: prev.rows_applied + f.rows_applied,
      warnings: [...(prev.warnings ?? []), ...(f.warnings ?? [])],
    });
  }
}

function withMergedApplyFiles(
  payload: ApplyJsonPayload,
  accumulated: Map<string, ApplyFile>,
): ApplyJsonPayload {
  if (accumulated.size === 0) return payload;
  const files = [...accumulated.values()];
  return {
    ...payload,
    files,
    summary: {
      ...payload.summary,
      files: files.length,
      files_modified: files.filter((f) => f.rows_applied > 0).length,
    },
  };
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
  const touchedAcrossPasses = new Map<string, ApplyFile>();
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
        payload: withMergedApplyFiles(
          {
            ...last.payload,
            passes: pass,
            terminated_by: "conflicts",
          },
          touchedAcrossPasses,
        ),
        passes: pass,
        terminated_by: "conflicts",
      };
    }
    if (last.payload.summary.rows === 0) {
      return {
        payload: withMergedApplyFiles(
          {
            ...last.payload,
            passes: pass,
            terminated_by: "empty",
          },
          touchedAcrossPasses,
        ),
        passes: pass,
        terminated_by: "empty",
      };
    }
    if (opts.dryRun) {
      return {
        payload: withMergedApplyFiles(
          {
            ...last.payload,
            passes: pass,
            terminated_by: "complete",
          },
          touchedAcrossPasses,
        ),
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
        payload: withMergedApplyFiles(
          {
            ...last.payload,
            passes: pass,
            terminated_by: "conflicts",
          },
          touchedAcrossPasses,
        ),
        passes: pass,
        terminated_by: "conflicts",
      };
    }
    if (last.payload.applied) {
      mergeApplyFiles(touchedAcrossPasses, last.payload.files);
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
    payload: withMergedApplyFiles(
      {
        ...last.payload,
        passes: opts.maxPasses,
        terminated_by: "cap",
      },
      touchedAcrossPasses,
    ),
    passes: opts.maxPasses,
    terminated_by: "cap",
  };
}

/** Git commit after apply when payload is commit-safe (no partial fixpoint). */
export function gitCommitAfterApplyIfEligible(opts: {
  projectRoot: string;
  message: string;
  payload: ApplyJsonPayload;
}): string | undefined {
  if (!opts.payload.applied || opts.payload.conflicts.length > 0) {
    return undefined;
  }
  const term = opts.payload.terminated_by;
  if (term !== undefined && term !== "empty") {
    return `codemap apply: --commit requires fixpoint terminated_by "empty" (got "${term}"). Omit --commit or raise --max-passes.`;
  }
  const filePaths = opts.payload.files.map((f) => f.file_path);
  if (filePaths.length === 0) return undefined;
  return gitCommitAppliedFiles({
    projectRoot: opts.projectRoot,
    message: opts.message,
    filePaths,
  });
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
