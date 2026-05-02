import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CodemapDatabase } from "../db";
import { hashContent } from "../hash";

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
      // Escape user input so `src/__tests__` doesn't over-match via SQL
      // LIKE's `_`-matches-any-char rule. Trailing `%` stays a wildcard.
      clauses.push("file_path LIKE ? ESCAPE '\\'");
      params.push(`${escapeLikeLiteral(prefix)}%`);
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

/**
 * Escape SQLite LIKE meta-characters (`_`, `%`) and the escape character
 * itself so a user-supplied path matches literally. Used with
 * `file_path LIKE ? ESCAPE '\'`.
 */
export function escapeLikeLiteral(s: string): string {
  return s.replace(/[\\_%]/g, (c) => `\\${c}`);
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

/**
 * Result of reading a symbol's source content from disk. `source` is the
 * file lines from `match.line_start..match.line_end` joined by newlines.
 * `stale` is true when the file's current content_hash differs from
 * `match`'s recorded hash (per Q-6 settled — read + flag, no auto-reindex).
 * `missing` is true when the file no longer exists on disk.
 */
export interface ReadSourceResult {
  source: string | undefined;
  stale: boolean;
  missing: boolean;
}

export interface ReadSymbolSourceOpts {
  match: SymbolMatch;
  projectRoot: string;
  /**
   * The indexed `content_hash` for `match.file_path` — same value
   * `cmd-validate.ts` reads. Pass `undefined` if the caller doesn't want
   * stale detection (always returns `stale: false`); pass the value from
   * `SELECT content_hash FROM files WHERE path = ?` to enable it.
   */
  indexedContentHash?: string | undefined;
}

/**
 * Read a symbol's source text from disk and compare against the indexed
 * hash for staleness. Per plan §9 Q-6 (settled): read + flag — agent
 * decides whether to act on possibly-shifted line ranges. No auto-reindex
 * (read tool, no side-effects); no refusal (data is already on disk).
 *
 * Same FS-read pattern `cmd-validate.ts` uses — `readFileSync(abs, "utf8")`
 * + `hashContent(source) !== indexedHash`. Reuses `hashContent` from
 * `src/hash.ts`. Line slicing is 1-indexed inclusive, matching the
 * `symbols.line_start` / `line_end` column convention.
 */
export function readSymbolSource(opts: ReadSymbolSourceOpts): ReadSourceResult {
  const abs = join(opts.projectRoot, opts.match.file_path);
  if (!existsSync(abs)) {
    return { source: undefined, stale: true, missing: true };
  }
  const content = readFileSync(abs, "utf8");
  const stale =
    opts.indexedContentHash !== undefined &&
    hashContent(content) !== opts.indexedContentHash;
  const lines = content.split("\n");
  // line_start / line_end are 1-indexed inclusive in the symbols table;
  // slice() is 0-indexed half-open, so subtract 1 from the start and use
  // line_end as the exclusive upper bound.
  const start = Math.max(0, opts.match.line_start - 1);
  const end = Math.min(lines.length, opts.match.line_end);
  const source = lines.slice(start, end).join("\n");
  return { source, stale, missing: false };
}

/**
 * Convenience: look up a file's indexed content_hash (same query
 * `cmd-validate.ts` uses). Returns `undefined` for unindexed paths so the
 * caller can decide what staleness means in that case.
 */
export function getIndexedContentHash(
  db: CodemapDatabase,
  filePath: string,
): string | undefined {
  const row = db
    .query("SELECT content_hash FROM files WHERE path = ?")
    .get(filePath) as { content_hash: string } | null;
  return row?.content_hash;
}
