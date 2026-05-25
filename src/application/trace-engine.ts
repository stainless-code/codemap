/**
 * Shared composers for MCP/HTTP `trace`, `explore`, and `node` — thin wrappers
 * over bundled `call-path` / `symbol-neighborhood` recipes plus `show` / snippet reads.
 */

import type { CodemapDatabase } from "../db";
import { closeDb, openDb } from "../db";
import {
  applySourceCharBudget,
  DEFAULT_OUTPUT_CHAR_BUDGET,
} from "./output-budget";
import { executeQuery } from "./query-engine";
import {
  getQueryRecipeActions,
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "./query-recipes";
import { resolveRecipeParams } from "./recipe-params";
import {
  buildShowResult,
  buildSnippetResult,
  findSymbolsByName,
} from "./show-engine";
import type { ShowResult, SnippetMatch, SymbolMatch } from "./show-engine";

export type TraceFailureKind = "param" | "query" | "internal";

/** Default row cap for explore before `truncation.rows` (structural payload guard). */
export const DEFAULT_EXPLORE_ROW_LIMIT = 500;

export interface CallPathHop {
  file_path: string;
  caller_name: string;
  callee_name: string;
  line_start: number;
  hop: number;
  via: string;
}

export interface SymbolNeighborhoodRow {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  edge: string;
  depth: number;
  via: string;
}

export interface TraceTruncation {
  snippets?: boolean;
  rows?: boolean;
}

function executeBundledRecipe(opts: {
  recipeId: string;
  root: string;
  provided: Record<string, string | number | boolean>;
}):
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const declared = getQueryRecipeParams(opts.recipeId);
  const resolved = resolveRecipeParams({
    recipeId: opts.recipeId,
    declared,
    provided: opts.provided,
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, kind: "param" };
  }

  const sql = getQueryRecipeSql(opts.recipeId);
  if (sql === undefined) {
    return {
      ok: false,
      error: `codemap: bundled recipe "${opts.recipeId}" missing`,
      kind: "internal",
    };
  }

  const payload = executeQuery({
    sql,
    bindValues: resolved.values,
    root: opts.root,
    recipeActions: getQueryRecipeActions(opts.recipeId),
  });

  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "error" in payload
  ) {
    return {
      ok: false,
      error: String((payload as { error: string }).error),
      kind: "query",
    };
  }

  return { ok: true, rows: payload as Record<string, unknown>[] };
}

export function executeCallPath(opts: {
  root: string;
  from: string;
  to: string;
  maxDepth?: number | undefined;
  via?: string | undefined;
}):
  | { ok: true; rows: CallPathHop[] }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const provided: Record<string, string | number | boolean> = {
    from: opts.from,
    to: opts.to,
  };
  if (opts.maxDepth !== undefined) provided.max_depth = opts.maxDepth;
  if (opts.via !== undefined) provided.via = opts.via;

  const result = executeBundledRecipe({
    recipeId: "call-path",
    root: opts.root,
    provided,
  });
  if (!result.ok) return result;
  return { ok: true, rows: result.rows as unknown as CallPathHop[] };
}

export function executeSymbolNeighborhood(opts: {
  root: string;
  name: string;
  depth?: number | undefined;
  kind?: string | undefined;
}):
  | { ok: true; rows: SymbolNeighborhoodRow[] }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const provided: Record<string, string | number | boolean> = {
    name: opts.name,
  };
  if (opts.depth !== undefined) provided.depth = opts.depth;
  if (opts.kind !== undefined) provided.kind = opts.kind;

  const result = executeBundledRecipe({
    recipeId: "symbol-neighborhood",
    root: opts.root,
    provided,
  });
  if (!result.ok) return result;
  return { ok: true, rows: result.rows as unknown as SymbolNeighborhoodRow[] };
}

/** Preserve first-occurrence order; drop duplicate seed names. */
export function dedupeNames(names: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function symbolKey(name: string, filePath: string): string {
  return `${name}\0${filePath}`;
}

function isCallHopSnippetEligible(hop: CallPathHop): boolean {
  return hop.via === "calls" && hop.line_start > 0;
}

function snippetsForSymbolMatches(opts: {
  db: CodemapDatabase;
  matches: SymbolMatch[];
  projectRoot: string;
}): SnippetMatch[] {
  if (opts.matches.length === 0) return [];
  return buildSnippetResult({
    db: opts.db,
    matches: opts.matches,
    projectRoot: opts.projectRoot,
  }).matches;
}

function lookupSymbolInFile(
  db: CodemapDatabase,
  name: string,
  filePath: string,
): SymbolMatch | undefined {
  const matches = findSymbolsByName(db, { name, inPath: filePath });
  return matches[0];
}

/** Prefer `preferredFile`, then fall back to global name lookup (cross-file callees). */
function lookupSymbolForName(
  db: CodemapDatabase,
  name: string,
  preferredFile?: string,
): SymbolMatch | undefined {
  if (preferredFile !== undefined && preferredFile.length > 0) {
    const local = lookupSymbolInFile(db, name, preferredFile);
    if (local !== undefined) return local;
  }
  return findSymbolsByName(db, { name })[0];
}

function snippetsForNeighborhoodRows(opts: {
  db: CodemapDatabase;
  rows: SymbolNeighborhoodRow[];
  projectRoot: string;
}): SnippetMatch[] {
  const seen = new Set<string>();
  const matches: SymbolMatch[] = [];
  for (const row of opts.rows) {
    const key = symbolKey(row.name, row.file_path);
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      name: row.name,
      kind: row.kind,
      file_path: row.file_path,
      line_start: row.line_start,
      line_end: row.line_end,
      signature: row.signature,
      is_exported: 0,
      parent_name: null,
      visibility: null,
    });
  }
  return snippetsForSymbolMatches({
    db: opts.db,
    matches,
    projectRoot: opts.projectRoot,
  });
}

function mergeSnippetMatches(
  primary: SnippetMatch[],
  secondary: SnippetMatch[],
): SnippetMatch[] {
  const seen = new Set<string>();
  const out: SnippetMatch[] = [];
  for (const item of [...primary, ...secondary]) {
    const key = symbolKey(item.name, item.file_path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Files connected to a scoped center symbol (call sites + definition files + deps). */
function collectNeighborFilesForCenter(
  db: CodemapDatabase,
  center: SymbolMatch,
): Set<string> {
  const files = new Set<string>([center.file_path]);
  const calls = db
    .query<{ file_path: string; caller_name: string; callee_name: string }>(
      `SELECT file_path, caller_name, callee_name FROM calls
       WHERE file_path = ? AND (caller_name = ? OR callee_name = ?)`,
    )
    .all(center.file_path, center.name, center.name) as {
    file_path: string;
    caller_name: string;
    callee_name: string;
  }[];
  for (const call of calls) {
    files.add(call.file_path);
    for (const otherName of [call.caller_name, call.callee_name]) {
      if (otherName === center.name) continue;
      for (const def of findSymbolsByName(db, { name: otherName })) {
        files.add(def.file_path);
      }
    }
  }
  const deps = db
    .query<{ from_path: string; to_path: string }>(
      `SELECT from_path, to_path FROM dependencies
       WHERE from_path = ? OR to_path = ?`,
    )
    .all(center.file_path, center.file_path) as {
    from_path: string;
    to_path: string;
  }[];
  for (const dep of deps) {
    files.add(dep.from_path);
    files.add(dep.to_path);
  }
  return files;
}

function filterNeighborhoodForCenter(
  db: CodemapDatabase,
  centerMatches: SymbolMatch[],
  rows: SymbolNeighborhoodRow[],
): SymbolNeighborhoodRow[] {
  if (centerMatches.length !== 1) return rows;
  const allowed = collectNeighborFilesForCenter(db, centerMatches[0]!);
  return rows.filter((row) => allowed.has(row.file_path));
}

function traceSnippetsSkippedReason(
  path: CallPathHop[],
  snippetCount: number,
): string | undefined {
  if (path.length === 0 || snippetCount > 0) return undefined;
  if (path.every((hop) => !isCallHopSnippetEligible(hop))) {
    return "Path uses file-level dependency hops; use query_recipe call-path rows with show/snippet per hop.";
  }
  return "No indexed symbol definitions matched hop names; path rows are still valid.";
}

function applyRowCap<T>(
  rows: T[],
  limit: number,
): { rows: T[]; rowsTruncated: boolean } {
  if (rows.length <= limit) return { rows, rowsTruncated: false };
  return { rows: rows.slice(0, limit), rowsTruncated: true };
}

export interface TraceComposeResult {
  from: string;
  to: string;
  via?: string | undefined;
  path: CallPathHop[];
  snippets: SnippetMatch[];
  truncated: boolean;
  truncation?: TraceTruncation;
  snippets_skipped_reason?: string;
}

export function composeTraceResult(opts: {
  root: string;
  from: string;
  to: string;
  via?: string | undefined;
  path: CallPathHop[];
  budgetChars?: number | undefined;
}): TraceComposeResult {
  const budget = opts.budgetChars ?? DEFAULT_OUTPUT_CHAR_BUDGET;
  const db = openDb();
  try {
    const seen = new Set<string>();
    const matches: SymbolMatch[] = [];
    for (const hop of opts.path) {
      if (!isCallHopSnippetEligible(hop)) continue;
      for (const name of [hop.caller_name, hop.callee_name]) {
        const key = symbolKey(name, hop.file_path);
        if (seen.has(key)) continue;
        const match = lookupSymbolForName(db, name, hop.file_path);
        if (match === undefined) continue;
        seen.add(symbolKey(match.name, match.file_path));
        matches.push(match);
      }
    }
    const allSnippets = snippetsForSymbolMatches({
      db,
      matches,
      projectRoot: opts.root,
    });
    const budgeted = applySourceCharBudget(allSnippets, budget);
    const snippetsSkippedReason = traceSnippetsSkippedReason(
      opts.path,
      budgeted.items.length,
    );
    return {
      from: opts.from,
      to: opts.to,
      via: opts.via,
      path: opts.path,
      snippets: budgeted.items,
      truncated: budgeted.truncated,
      ...(budgeted.truncated
        ? { truncation: { snippets: true } satisfies TraceTruncation }
        : {}),
      ...(snippetsSkippedReason !== undefined
        ? { snippets_skipped_reason: snippetsSkippedReason }
        : {}),
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

export interface ExploreComposeResult {
  names: string[];
  rows: SymbolNeighborhoodRow[];
  snippets: SnippetMatch[];
  truncated: boolean;
  truncation?: TraceTruncation;
}

export function composeExploreResult(opts: {
  root: string;
  names: string[];
  depth?: number | undefined;
  kind?: string | undefined;
  budgetChars?: number | undefined;
  rowLimit?: number | undefined;
}):
  | { ok: true; result: ExploreComposeResult }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const names = dedupeNames(opts.names);
  const merged: SymbolNeighborhoodRow[] = [];
  const seenRows = new Set<string>();
  for (const name of names) {
    const neighborhood = executeSymbolNeighborhood({
      root: opts.root,
      name,
      depth: opts.depth,
      kind: opts.kind,
    });
    if (!neighborhood.ok) return neighborhood;
    for (const row of neighborhood.rows) {
      const key = `${row.name}\0${row.file_path}\0${row.edge}\0${row.depth}\0${row.via}`;
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      merged.push(row);
    }
  }

  const rowLimit = opts.rowLimit ?? DEFAULT_EXPLORE_ROW_LIMIT;
  const rowCapped = applyRowCap(merged, rowLimit);

  const budget = opts.budgetChars ?? DEFAULT_OUTPUT_CHAR_BUDGET;
  const db = openDb();
  try {
    const allSnippets = snippetsForNeighborhoodRows({
      db,
      rows: rowCapped.rows,
      projectRoot: opts.root,
    });
    const budgeted = applySourceCharBudget(allSnippets, budget);
    const truncation: TraceTruncation = {};
    if (budgeted.truncated) truncation.snippets = true;
    if (rowCapped.rowsTruncated) truncation.rows = true;
    return {
      ok: true,
      result: {
        names,
        rows: rowCapped.rows,
        snippets: budgeted.items,
        truncated: budgeted.truncated || rowCapped.rowsTruncated,
        ...(Object.keys(truncation).length > 0 ? { truncation } : {}),
      },
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}

export interface NodeComposeResult {
  center: ShowResult;
  neighborhood: SymbolNeighborhoodRow[];
  snippets: SnippetMatch[];
  truncated: boolean;
  truncation?: TraceTruncation;
}

export function composeNodeResult(opts: {
  root: string;
  name: string;
  kind?: string | undefined;
  inPath?: string | undefined;
  includeSnippets?: boolean | undefined;
  budgetChars?: number | undefined;
}):
  | { ok: true; result: NodeComposeResult }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const neighborhood = executeSymbolNeighborhood({
    root: opts.root,
    name: opts.name,
    depth: 1,
    kind: opts.kind,
  });
  if (!neighborhood.ok) return neighborhood;

  const db = openDb();
  try {
    const matches = findSymbolsByName(db, {
      name: opts.name,
      kind: opts.kind,
      inPath: opts.inPath,
    });
    const center = buildShowResult(matches);
    const scopedNeighborhood = filterNeighborhoodForCenter(
      db,
      matches,
      neighborhood.rows,
    );

    let snippets: SnippetMatch[] = [];
    let truncated = false;
    if (opts.includeSnippets === true) {
      const budget = opts.budgetChars ?? DEFAULT_OUTPUT_CHAR_BUDGET;
      const centerSnippets = snippetsForSymbolMatches({
        db,
        matches,
        projectRoot: opts.root,
      });
      const neighborSnippets = snippetsForNeighborhoodRows({
        db,
        rows: scopedNeighborhood,
        projectRoot: opts.root,
      });
      const merged = mergeSnippetMatches(centerSnippets, neighborSnippets);
      const budgeted = applySourceCharBudget(merged, budget);
      snippets = budgeted.items;
      truncated = budgeted.truncated;
    }

    return {
      ok: true,
      result: {
        center,
        neighborhood: scopedNeighborhood,
        snippets,
        truncated,
        ...(truncated ? { truncation: { snippets: true } } : {}),
      },
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}
