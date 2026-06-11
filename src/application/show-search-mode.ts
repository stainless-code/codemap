import { isAbsolute } from "node:path";

import type { CodemapDatabase } from "../db";
import { getFts5Enabled } from "../runtime";
import {
  buildSymbolSearchSql,
  formatSymbolSearchSqlForDisplay,
  isSourceFtsPopulated,
  searchSymbols,
} from "./search-engine";
import { parseSearchQuery } from "./search-query-parser";
import type {
  ParsedSearchQuery,
  ParseSearchQueryResult,
} from "./search-query-parser";
import { findSymbolsByName } from "./show-engine";
import type { SymbolMatch } from "./show-engine";
import { toProjectRelative } from "./validate-engine";

/** True when a `name:` pattern has no unescaped LIKE metacharacters (`%`, `_`). */
export function isExactNamePattern(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      i++;
      continue;
    }
    if (c === "%" || c === "_") return false;
  }
  return true;
}

/**
 * Fast tier: single `name:` token, no wildcards, no kind/path/in/free-text —
 * route to equality lookup (`name = ?`) instead of `name LIKE`.
 */
export function resolveExactNameFromParsedQuery(
  parsed: ParsedSearchQuery,
): string | undefined {
  if (parsed.freeText.length > 0) return undefined;
  if (parsed.kind !== undefined) return undefined;
  if (parsed.path !== undefined) return undefined;
  if (parsed.inGlob !== undefined) return undefined;
  if (parsed.namePatterns.length !== 1) return undefined;
  const pattern = parsed.namePatterns[0]!;
  if (!isExactNamePattern(pattern)) return undefined;
  return pattern;
}

const EXACT_NAME_LOOKUP_SQL = `SELECT name, kind, file_path, line_start, line_end, signature,
                      is_exported, parent_name, visibility
               FROM symbols
               WHERE name = ?
               ORDER BY file_path ASC, line_start ASC`;

/** Moat-A SQL preview for fast-tier `name:Token` lookups. */
export function formatExactNameLookupSqlForDisplay(name: string): string {
  const escaped = name.replace(/'/g, "''");
  return EXACT_NAME_LOOKUP_SQL.replace("?", `'${escaped}'`).trim();
}

export type ShowLookupMode =
  | { ok: true; kind: "exact"; name: string; inPath: string | undefined }
  | { ok: true; kind: "query"; parsed: ParsedSearchQuery }
  | { ok: false; error: string };

export type ResolvedShowLookupMode = Extract<ShowLookupMode, { ok: true }>;

export interface ShowSnippetLookupArgs {
  name?: string | undefined;
  query?: string | undefined;
  kind?: string | undefined;
  in?: string | undefined;
}

/** Shared name/query/kind/in rules for CLI argv finalization and MCP/HTTP handlers. */
export function validateShowSnippetLookupArgs(
  args: ShowSnippetLookupArgs,
): { ok: true } | { ok: false; error: string } {
  const hasName = args.name !== undefined && args.name.length > 0;
  const hasQuery = args.query !== undefined && args.query.length > 0;
  if (hasName && hasQuery) {
    return { ok: false, error: "pass either name or query, not both." };
  }
  if (!hasName && !hasQuery) {
    return { ok: false, error: "name or query is required." };
  }
  if (hasQuery && (args.kind !== undefined || args.in !== undefined)) {
    return {
      ok: false,
      error:
        "kind / in apply to exact-name lookup only; use kind: / path: / in: inside query.",
    };
  }
  return { ok: true };
}

export interface FormatShowSearchSqlResult {
  ok: true;
  sql: string;
  warning?: string;
}

/** Moat-A SQL preview for `--print-sql` (shared FTS resolution + SQL builder). */
export function formatShowSearchSqlForQuery(
  query: string,
  projectRoot: string,
  opts: { withFtsCli: boolean; db?: CodemapDatabase | undefined },
): FormatShowSearchSqlResult | { ok: false; error: string } {
  const parsedQuery = parseAndNormalizeSearchQuery(query, projectRoot);
  if (!parsedQuery.ok) return parsedQuery;

  let useFts = false;
  let warning: string | undefined;
  const exactName = resolveExactNameFromParsedQuery(parsedQuery.parsed);
  if (exactName !== undefined) {
    return {
      ok: true,
      sql: formatExactNameLookupSqlForDisplay(exactName),
    };
  }

  if (parsedQuery.parsed.freeText.length > 0 && opts.db !== undefined) {
    const fts = resolveSearchWithFts(opts.db, {
      withFtsCli: opts.withFtsCli,
      freeTextCount: parsedQuery.parsed.freeText.length,
    });
    warning = fts.warning;
    useFts = fts.useFts;
  }

  const built = buildSymbolSearchSql({
    parsed: parsedQuery.parsed,
    withFts: useFts,
  });
  return {
    ok: true,
    sql: formatSymbolSearchSqlForDisplay(built),
    warning,
  };
}

export interface ExecuteShowLookupOpts {
  withFtsCli: boolean;
  /** Exact-name mode only — `kind` from `--kind` / MCP `kind`. */
  exactKind?: string | undefined;
}

export interface ExecuteShowLookupResult {
  matches: SymbolMatch[];
  warning?: string;
}

/** Run exact-name or field-qualified lookup (shared by CLI, MCP, HTTP). */
export function executeShowLookup(
  db: CodemapDatabase,
  mode: ResolvedShowLookupMode,
  opts: ExecuteShowLookupOpts,
): ExecuteShowLookupResult {
  if (mode.kind === "exact") {
    return {
      matches: findSymbolsByName(db, {
        name: mode.name,
        kind: opts.exactKind,
        inPath: mode.inPath,
      }),
    };
  }

  const exactName = resolveExactNameFromParsedQuery(mode.parsed);
  if (exactName !== undefined) {
    return {
      matches: findSymbolsByName(db, { name: exactName }),
    };
  }

  const fts = resolveSearchWithFts(db, {
    withFtsCli: opts.withFtsCli,
    freeTextCount: mode.parsed.freeText.length,
  });
  return {
    matches: searchSymbols(db, {
      parsed: mode.parsed,
      withFts: fts.useFts,
    }),
    warning: fts.warning,
  };
}

/** Parse `--query` and normalize `path:` / `in:` to project-relative keys. */
export function parseAndNormalizeSearchQuery(
  query: string,
  projectRoot: string,
): ParseSearchQueryResult {
  const result = parseSearchQuery(query);
  if (!result.ok) return result;
  const parsed: ParsedSearchQuery = {
    ...result.parsed,
    namePatterns: [...result.parsed.namePatterns],
    freeText: [...result.parsed.freeText],
  };
  if (parsed.path !== undefined) {
    parsed.path = toProjectRelative(projectRoot, parsed.path);
  }
  if (parsed.inGlob !== undefined) {
    parsed.inGlob = normalizeSearchInGlob(projectRoot, parsed.inGlob);
  }
  return { ok: true, parsed };
}

/** Normalize absolute path prefixes in `in:` globs to project-relative keys. */
export function normalizeSearchInGlob(
  projectRoot: string,
  glob: string,
): string {
  const metaIdx = glob.search(/[*?[]/);
  if (metaIdx === -1) {
    return isAbsolute(glob) ? toProjectRelative(projectRoot, glob) : glob;
  }
  const prefix = glob.slice(0, metaIdx);
  const suffix = glob.slice(metaIdx);
  const prefixBody = prefix.replace(/\/+$/, "");
  if (prefixBody.length === 0 || !isAbsolute(prefixBody)) return glob;
  const rel = toProjectRelative(projectRoot, prefixBody);
  const sep = prefix.endsWith("/") ? "/" : "";
  return `${rel}${sep}${suffix}`;
}

export interface ResolveSearchWithFtsResult {
  useFts: boolean;
  warning?: string;
}

/** When config `fts5` is on or CLI/MCP flag set, use FTS for free-text tokens. */
export function resolveSearchWithFts(
  db: CodemapDatabase,
  opts: { withFtsCli: boolean; freeTextCount: number },
): ResolveSearchWithFtsResult {
  if (opts.freeTextCount === 0) return { useFts: false };
  const wantFts = opts.withFtsCli || getFts5Enabled();
  if (!wantFts) return { useFts: false };
  if (!isSourceFtsPopulated(db)) {
    return {
      useFts: false,
      warning:
        "FTS requested (fts5 config or with_fts / --with-fts) but source_fts is empty. Re-index with --with-fts or fts5: true.",
    };
  }
  return { useFts: true };
}

export function resolveShowLookupMode(
  args: ShowSnippetLookupArgs,
  root: string,
): ShowLookupMode {
  const validation = validateShowSnippetLookupArgs(args);
  if (!validation.ok) return validation;

  const hasQuery = args.query !== undefined && args.query.length > 0;
  if (hasQuery) {
    const parsed = parseAndNormalizeSearchQuery(args.query!, root);
    if (!parsed.ok) return parsed;
    return { ok: true, kind: "query", parsed: parsed.parsed };
  }
  const inPath =
    args.in !== undefined && args.in.length > 0
      ? toProjectRelative(root, args.in)
      : undefined;
  return { ok: true, kind: "exact", name: args.name!, inPath };
}
