/**
 * Shared `affected-tests` preprocessor + recipe executor — used by
 * `codemap affected` (CLI) and the MCP/HTTP `affected` tool.
 */

import { getFilesChangedSince } from "../git-changed";
import { executeQuery } from "./query-engine";
import {
  getQueryRecipeActions,
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "./query-recipes";
import { resolveRecipeParams } from "./recipe-params";
import { tryRecordRecipeRun } from "./recipe-recency";

/** Delimiter for `affected-tests.changed_files` (ASCII RS). */
export const CHANGED_PATH_DELIM = "\u001e";

/** Trim, drop `./`, dedupe; preserve first-occurrence order. */
export function normalizeChangedPathList(paths: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const path = raw.trim().replace(/^\.\/+/, "");
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** Join project-relative paths for the `affected-tests` recipe param. */
export function joinChangedPaths(paths: Iterable<string>): string {
  return normalizeChangedPathList(paths).join(CHANGED_PATH_DELIM);
}

/**
 * Resolve changed paths for agent transports: explicit `paths` wins;
 * otherwise git diff + working tree vs `changedSince` (default `HEAD`).
 */
export function resolveAffectedChangedPaths(opts: {
  root: string;
  paths?: string[] | undefined;
  changedSince?: string | undefined;
}): { ok: true; paths: string[] } | { ok: false; error: string } {
  if (opts.paths !== undefined) {
    return { ok: true, paths: normalizeChangedPathList(opts.paths) };
  }
  const ref = opts.changedSince ?? "HEAD";
  const result = getFilesChangedSince(ref, opts.root);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, paths: normalizeChangedPathList(result.files) };
}

export function executeAffectedTests(opts: {
  root: string;
  changedPaths: string[];
  testGlob?: string | undefined;
  maxDepth?: number | undefined;
}): { ok: true; rows: unknown[] } | { ok: false; error: string } {
  const changedRaw = joinChangedPaths(opts.changedPaths);
  if (changedRaw.length === 0) {
    return { ok: true, rows: [] };
  }

  const declared = getQueryRecipeParams("affected-tests");
  const resolved = resolveRecipeParams({
    recipeId: "affected-tests",
    declared,
    provided: {
      changed_files: changedRaw,
      ...(opts.testGlob !== undefined ? { test_glob: opts.testGlob } : {}),
      ...(opts.maxDepth !== undefined ? { max_depth: opts.maxDepth } : {}),
    },
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const sql = getQueryRecipeSql("affected-tests");
  if (sql === undefined) {
    return {
      ok: false,
      error: 'codemap affected: bundled recipe "affected-tests" missing',
    };
  }

  const payload = executeQuery({
    sql,
    bindValues: resolved.values,
    root: opts.root,
    recipeActions: getQueryRecipeActions("affected-tests"),
  });

  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "error" in payload
  ) {
    return { ok: false, error: String((payload as { error: string }).error) };
  }

  tryRecordRecipeRun("affected-tests");
  return { ok: true, rows: payload as unknown[] };
}
