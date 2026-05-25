/** v1 field-qualified search tokens (`kind:`, `name:`, `path:`, `in:`). */
export const SEARCH_QUERY_FIELDS = ["kind", "name", "path", "in"] as const;

export type SearchQueryField = (typeof SEARCH_QUERY_FIELDS)[number];

const FIELD_SET = new Set<string>(SEARCH_QUERY_FIELDS);

export interface ParsedSearchQuery {
  /** Exact `symbols.kind` match when set. */
  kind?: string;
  /** Substring filters on `symbols.name` from explicit `name:` tokens (ANDed). */
  namePatterns: string[];
  /** Unqualified tokens — `name LIKE` when FTS off, `source_fts MATCH` when FTS on. */
  freeText: string[];
  /** Optional `file_path` prefix / exact filter from `path:`. */
  path?: string;
  /** Optional SQLite GLOB on `file_path` from `in:`. */
  inGlob?: string;
}

export type ParseSearchQueryResult =
  | { ok: true; parsed: ParsedSearchQuery }
  | { ok: false; error: string };

/**
 * Parse a field-qualified symbol search string such as
 * `kind:function name:Auth path:src/`. Quoted values (`name:"useQuery"`)
 * survive whitespace; unknown `field:` names fail fast.
 */
export function parseSearchQuery(input: string): ParseSearchQueryResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "search query must not be empty." };
  }

  const parsed: ParsedSearchQuery = {
    namePatterns: [],
    freeText: [],
  };

  for (const token of tokenizeSearchQuery(trimmed)) {
    const colon = token.indexOf(":");
    if (colon <= 0) {
      const value = unquoteSearchValue(token);
      if (value.length === 0) continue;
      parsed.freeText.push(value);
      continue;
    }

    const field = token.slice(0, colon);
    if (!FIELD_SET.has(field)) {
      return {
        ok: false,
        error: `unknown search field "${field}". Supported: ${SEARCH_QUERY_FIELDS.join(", ")}.`,
      };
    }

    const value = unquoteSearchValue(token.slice(colon + 1));
    if (value.length === 0) {
      return { ok: false, error: `search field "${field}" requires a value.` };
    }

    switch (field as SearchQueryField) {
      case "kind": {
        if (parsed.kind !== undefined) {
          return {
            ok: false,
            error: 'duplicate "kind" field — pass at most one kind: value.',
          };
        }
        parsed.kind = value;
        break;
      }
      case "name": {
        parsed.namePatterns.push(value);
        break;
      }
      case "path": {
        if (parsed.path !== undefined) {
          return {
            ok: false,
            error: 'duplicate "path" field — pass at most one path: value.',
          };
        }
        parsed.path = value;
        break;
      }
      case "in": {
        if (parsed.inGlob !== undefined) {
          return {
            ok: false,
            error: 'duplicate "in" field — pass at most one in: value.',
          };
        }
        parsed.inGlob = value;
        break;
      }
    }
  }

  if (
    parsed.kind === undefined &&
    parsed.namePatterns.length === 0 &&
    parsed.path === undefined &&
    parsed.inGlob === undefined &&
    parsed.freeText.length === 0
  ) {
    return { ok: false, error: "search query has no filters." };
  }

  return { ok: true, parsed };
}

/** Split on whitespace; honour `"..."` / `'...'` segments (including after `field:`). */
export function tokenizeSearchQuery(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;

    const start = i;
    if (input[i] === '"' || input[i] === "'") {
      const { nextIndex, closed } = readQuotedSegment(input, i);
      if (!closed) {
        throw new Error("unclosed quoted value in search query");
      }
      tokens.push(input.slice(start, nextIndex));
      i = nextIndex;
      continue;
    }

    while (i < input.length && !/\s/.test(input[i]!)) i++;

    const colon = input.indexOf(":", start);
    if (colon !== -1 && colon < i) {
      const afterColon = colon + 1;
      const quote = input[afterColon];
      if (quote === '"' || quote === "'") {
        const { nextIndex, closed } = readQuotedSegment(input, afterColon);
        if (!closed) {
          throw new Error("unclosed quoted value in search query");
        }
        i = nextIndex;
      }
    }

    tokens.push(input.slice(start, i));
  }
  return tokens;
}

function readQuotedSegment(
  input: string,
  start: number,
): { value: string; nextIndex: number; closed: boolean } {
  const quote = input[start]!;
  let value = "";
  let i = start + 1;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\" && i + 1 < input.length) {
      value += input[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value, nextIndex: i + 1, closed: true };
    }
    value += ch;
    i++;
  }
  return { value, nextIndex: i, closed: false };
}

function unquoteSearchValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0]!;
    const last = trimmed[trimmed.length - 1]!;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
