/**
 * Shared composers for MCP/HTTP `trace`, `explore`, and `node` — thin wrappers
 * over bundled `call-path` / `symbol-neighborhood` recipes plus `show` / snippet reads.
 */

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

function symbolKey(name: string, filePath: string): string {
  return `${name}\0${filePath}`;
}

function isCallHopSnippetEligible(hop: CallPathHop): boolean {
  return hop.via === "calls" && hop.line_start > 0;
}

function snippetsForSymbolMatches(opts: {
  db: ReturnType<typeof openDb>;
  matches: SymbolMatch[];
  projectRoot: string;
}): SnippetMatch[] {
  return buildSnippetResult({
    db: opts.db,
    matches: opts.matches,
    projectRoot: opts.projectRoot,
  }).matches;
}

function lookupSymbolInFile(
  db: ReturnType<typeof openDb>,
  name: string,
  filePath: string,
): SymbolMatch | undefined {
  const matches = findSymbolsByName(db, { name, inPath: filePath });
  return matches[0];
}

function snippetsForNeighborhoodRows(opts: {
  db: ReturnType<typeof openDb>;
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

export interface TraceComposeResult {
  from: string;
  to: string;
  via?: string | undefined;
  path: CallPathHop[];
  snippets: SnippetMatch[];
  truncated: boolean;
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
        seen.add(key);
        const match = lookupSymbolInFile(db, name, hop.file_path);
        if (match !== undefined) matches.push(match);
      }
    }
    const allSnippets = snippetsForSymbolMatches({
      db,
      matches,
      projectRoot: opts.root,
    });
    const budgeted = applySourceCharBudget(allSnippets, budget);
    return {
      from: opts.from,
      to: opts.to,
      via: opts.via,
      path: opts.path,
      snippets: budgeted.items,
      truncated: budgeted.truncated,
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
}

export function composeExploreResult(opts: {
  root: string;
  names: string[];
  depth?: number | undefined;
  kind?: string | undefined;
  budgetChars?: number | undefined;
}):
  | { ok: true; result: ExploreComposeResult }
  | { ok: false; error: string; kind: TraceFailureKind } {
  const merged: SymbolNeighborhoodRow[] = [];
  const seenRows = new Set<string>();
  for (const name of opts.names) {
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

  const budget = opts.budgetChars ?? DEFAULT_OUTPUT_CHAR_BUDGET;
  const db = openDb();
  try {
    const allSnippets = snippetsForNeighborhoodRows({
      db,
      rows: merged,
      projectRoot: opts.root,
    });
    const budgeted = applySourceCharBudget(allSnippets, budget);
    return {
      ok: true,
      result: {
        names: opts.names,
        rows: merged,
        snippets: budgeted.items,
        truncated: budgeted.truncated,
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

    let snippets: SnippetMatch[] = [];
    let truncated = false;
    if (opts.includeSnippets === true) {
      const budget = opts.budgetChars ?? DEFAULT_OUTPUT_CHAR_BUDGET;
      const allSnippets = snippetsForNeighborhoodRows({
        db,
        rows: neighborhood.rows,
        projectRoot: opts.root,
      });
      const budgeted = applySourceCharBudget(allSnippets, budget);
      snippets = budgeted.items;
      truncated = budgeted.truncated;
    }

    return {
      ok: true,
      result: {
        center,
        neighborhood: neighborhood.rows,
        snippets,
        truncated,
      },
    };
  } finally {
    closeDb(db, { readonly: true });
  }
}
