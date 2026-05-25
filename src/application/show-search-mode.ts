import type { CodemapDatabase } from "../db";
import { getFts5Enabled } from "../runtime";
import { isSourceFtsPopulated } from "./search-engine";
import { parseSearchQuery } from "./search-query-parser";
import type {
  ParsedSearchQuery,
  ParseSearchQueryResult,
} from "./search-query-parser";
import { toProjectRelative } from "./validate-engine";

export type ShowLookupMode =
  | { ok: true; kind: "exact"; name: string; inPath: string | undefined }
  | { ok: true; kind: "query"; parsed: ParsedSearchQuery }
  | { ok: false; error: string };

/** Parse `--query` and normalize `path:` to project-relative keys. */
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
  return { ok: true, parsed };
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
    if (opts.withFtsCli) {
      return {
        useFts: false,
        warning:
          "with_fts ignored — source_fts is empty. Re-index with --with-fts or fts5: true.",
      };
    }
    return { useFts: false };
  }
  return { useFts: true };
}

export function resolveShowLookupMode(
  args: {
    name?: string | undefined;
    query?: string | undefined;
    kind?: string | undefined;
    in?: string | undefined;
  },
  root: string,
): ShowLookupMode {
  const hasName = args.name !== undefined && args.name.length > 0;
  const hasQuery = args.query !== undefined && args.query.length > 0;
  if (hasName && hasQuery) {
    return { ok: false, error: "pass either name or query, not both." };
  }
  if (!hasName && !hasQuery) {
    return { ok: false, error: "name or query is required." };
  }
  if (hasQuery) {
    if (args.kind !== undefined || args.in !== undefined) {
      return {
        ok: false,
        error:
          "kind / in apply to exact-name lookup only; use kind: / path: / in: inside query.",
      };
    }
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
