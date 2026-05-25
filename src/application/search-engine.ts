import type { CodemapDatabase } from "../db";
import type { ParsedSearchQuery } from "./search-query-parser";
import type { SymbolMatch } from "./show-engine";
import { escapeLikeLiteral } from "./show-engine";

export interface BuildSymbolSearchSqlOpts {
  parsed: ParsedSearchQuery;
  /** When true, unqualified free-text tokens use `source_fts MATCH` instead of `name LIKE`. */
  withFts?: boolean | undefined;
}

export interface SymbolSearchSql {
  sql: string;
  params: (string | number)[];
}

const SYMBOL_COLUMNS = `name, kind, file_path, line_start, line_end, signature,
                      is_exported, parent_name, visibility`;

/**
 * Build parameterized SQL for a parsed field-qualified search. Moat-A clean:
 * every filter is a plain WHERE on `symbols` (+ optional `source_fts` join).
 */
export function buildSymbolSearchSql(
  opts: BuildSymbolSearchSqlOpts,
): SymbolSearchSql {
  const useFts = opts.withFts === true && opts.parsed.freeText.length > 0;
  const alias = useFts ? "s" : undefined;
  const params: (string | number)[] = [];
  const clauses: string[] = [];

  let fromClause = "symbols";
  if (useFts) {
    fromClause = "symbols s JOIN source_fts fts ON fts.file_path = s.file_path";
    clauses.push("source_fts MATCH ?");
    params.push(opts.parsed.freeText.join(" "));
  }

  const nameColumn = alias !== undefined ? `${alias}.name` : "name";
  const kindColumn = alias !== undefined ? `${alias}.kind` : "kind";
  const pathColumn = alias !== undefined ? `${alias}.file_path` : "file_path";

  if (opts.parsed.kind !== undefined) {
    clauses.push(`${kindColumn} = ?`);
    params.push(opts.parsed.kind);
  }

  for (const pattern of opts.parsed.namePatterns) {
    clauses.push(`${nameColumn} LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLikeLiteral(pattern)}%`);
  }

  if (!useFts) {
    for (const term of opts.parsed.freeText) {
      clauses.push(`${nameColumn} LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikeLiteral(term)}%`);
    }
  }

  if (opts.parsed.path !== undefined) {
    appendPathFilter(pathColumn, opts.parsed.path, clauses, params);
  }

  if (opts.parsed.inGlob !== undefined) {
    clauses.push(`${pathColumn} GLOB ?`);
    params.push(opts.parsed.inGlob);
  }

  const selectColumns =
    alias !== undefined
      ? SYMBOL_COLUMNS.split(",")
          .map((c) => `${alias}.${c.trim()}`)
          .join(", ")
      : SYMBOL_COLUMNS;

  const orderColumn = alias !== undefined ? `${alias}.file_path` : "file_path";
  const lineColumn = alias !== undefined ? `${alias}.line_start` : "line_start";

  const sql = `SELECT ${selectColumns}
               FROM ${fromClause}
               WHERE ${clauses.join(" AND ")}
               ORDER BY ${orderColumn} ASC, ${lineColumn} ASC`;

  return { sql, params };
}

/** Run a field-qualified search and return symbol rows. */
export function searchSymbols(
  db: CodemapDatabase,
  opts: BuildSymbolSearchSqlOpts,
): SymbolMatch[] {
  const built = buildSymbolSearchSql(opts);
  return db.query(built.sql).all(...built.params) as SymbolMatch[];
}

/** Inline bind values for `--print-sql` / agent transparency (Moat A). */
export function formatSymbolSearchSqlForDisplay(
  built: SymbolSearchSql,
): string {
  let i = 0;
  const rendered = built.sql.replace(/\?/g, () => {
    const value = built.params[i];
    i++;
    if (typeof value === "number") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
  return rendered.trim();
}

/** True when `source_fts` has at least one row (FTS5 was indexed). */
export function isSourceFtsPopulated(db: CodemapDatabase): boolean {
  const row = db.query("SELECT COUNT(*) AS n FROM source_fts").get() as {
    n: number;
  };
  return row.n > 0;
}

function appendPathFilter(
  pathColumn: string,
  pathValue: string,
  clauses: string[],
  params: (string | number)[],
): void {
  if (looksLikeDirectory(pathValue)) {
    const prefix = pathValue.endsWith("/") ? pathValue : `${pathValue}/`;
    clauses.push(`${pathColumn} LIKE ? ESCAPE '\\'`);
    params.push(`${escapeLikeLiteral(prefix)}%`);
    return;
  }
  clauses.push(`${pathColumn} = ?`);
  params.push(pathValue);
}

function looksLikeDirectory(p: string): boolean {
  if (p.endsWith("/")) return true;
  const lastSlash = p.lastIndexOf("/");
  const tail = lastSlash === -1 ? p : p.slice(lastSlash + 1);
  return !tail.includes(".");
}
