import type { CodemapDatabase } from "../db";

/**
 * One row from the `symbols` table — the canonical match shape returned by
 * `findSymbolsByName`. Same columns the CLI / MCP `show` verbs surface in
 * their `--json` envelopes, plus the always-present `signature` so an agent
 * can disambiguate without a follow-up read.
 */
export interface SymbolMatch {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  is_exported: number;
  parent_name: string | null;
  visibility: string | null;
}

export interface FindSymbolsOpts {
  /** Exact symbol name (case-sensitive — per plan §9 Q-3). */
  name: string;
  /** Optional `symbols.kind` filter (e.g. "function", "const", "class"). */
  kind?: string | undefined;
  /**
   * Optional file-scope filter. If `<inPath>` ends with `/` or matches a
   * directory shape, treats as prefix (`AND file_path LIKE 'src/cli/%'`);
   * otherwise exact match (`AND file_path = 'src/cli/cmd-show.ts'`).
   * Caller should normalize via `toProjectRelative` before passing — this
   * engine does no path-shape massaging beyond the prefix/exact split.
   */
  inPath?: string | undefined;
}

/**
 * Pure transport-agnostic lookup — same shape `cmd-show.ts` and the MCP
 * `show` tool both call. Mirrors the `audit-engine.ts` / `query-engine.ts`
 * pattern from PRs #33 / #35.
 *
 * Returns rows ordered deterministically (`file_path ASC, line_start ASC`)
 * so callers can slice the array and get stable disambiguation output.
 */
export function findSymbolsByName(
  db: CodemapDatabase,
  opts: FindSymbolsOpts,
): SymbolMatch[] {
  const clauses: string[] = ["name = ?"];
  const params: (string | number)[] = [opts.name];

  if (opts.kind !== undefined && opts.kind.length > 0) {
    clauses.push("kind = ?");
    params.push(opts.kind);
  }

  if (opts.inPath !== undefined && opts.inPath.length > 0) {
    if (looksLikeDirectory(opts.inPath)) {
      const prefix = opts.inPath.endsWith("/")
        ? opts.inPath
        : `${opts.inPath}/`;
      clauses.push("file_path LIKE ?");
      params.push(`${prefix}%`);
    } else {
      clauses.push("file_path = ?");
      params.push(opts.inPath);
    }
  }

  const sql = `SELECT name, kind, file_path, line_start, line_end, signature,
                      is_exported, parent_name, visibility
               FROM symbols
               WHERE ${clauses.join(" AND ")}
               ORDER BY file_path ASC, line_start ASC`;
  return db.query(sql).all(...params) as SymbolMatch[];
}

// Heuristic: `--in src/cli/` (trailing slash) and `--in src/cli` (no slash, no
// dot) both mean "prefix"; `--in src/cli/cmd-show.ts` (has a file extension
// after the last slash) means "exact file match". Conservative: anything
// ambiguous treats as prefix — over-matching is recoverable (agent narrows
// further); under-matching silently misses results.
function looksLikeDirectory(p: string): boolean {
  if (p.endsWith("/")) return true;
  const lastSlash = p.lastIndexOf("/");
  const tail = lastSlash === -1 ? p : p.slice(lastSlash + 1);
  // No `.` in the trailing segment → directory-shaped (e.g. `src/cli`).
  // A `.` → file-shaped (e.g. `src/cli/cmd-show.ts`, `cmd-show.ts`).
  return !tail.includes(".");
}
