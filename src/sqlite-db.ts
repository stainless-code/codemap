import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { getDatabasePath } from "./runtime";

const require = createRequire(import.meta.url);

/** Values accepted by SQLite bindings for bound parameters. */
export type BindValues = (string | number | null)[];

/**
 * Minimal SQLite surface used by Codemap — implemented for `bun:sqlite` and
 * `better-sqlite3` (sync APIs, transactions, PRAGMAs).
 */
export interface CodemapDatabase {
  run(sql: string, params?: BindValues): void;
  query<T>(sql: string): {
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
  };
  /** Returns a function that runs the transaction when invoked (Bun / better-sqlite3 semantics). */
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

interface SqliteInner {
  run(sql: string, params?: BindValues): void;
  query(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): unknown;
  close(): void;
}

/**
 * `better-sqlite3` allows only one statement per `prepare()`; `bun:sqlite` accepts several.
 * On Node we split on `;` — do not put `;` inside `--` line comments in `db.ts` SQL strings.
 */
function runSql(inner: SqliteInner, sql: string, params?: BindValues): void {
  if (params !== undefined && params.length > 0) {
    inner.run(sql, params);
    return;
  }
  if (typeof Bun !== "undefined") {
    inner.run(sql);
    return;
  }
  const parts = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    inner.run(sql.trim());
  } else {
    for (const p of parts) {
      inner.run(p);
    }
  }
}

function openRaw(path: string): SqliteInner {
  if (typeof Bun !== "undefined") {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string, opts?: { create?: boolean }) => unknown;
    };
    return new Database(path, { create: true }) as SqliteInner;
  }

  type BetterSqlite = typeof import("better-sqlite3");
  const BetterSqlite = require("better-sqlite3") as BetterSqlite;
  const rawDb = new BetterSqlite(path);
  const stmtCache = new Map<string, any>();

  function cachedPrepare(sql: string) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = rawDb.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  return {
    run(sql: string, params?: BindValues) {
      const stmt = cachedPrepare(sql);
      if (params !== undefined && params.length > 0) {
        stmt.run(...params);
      } else {
        stmt.run();
      }
    },
    query(sql: string) {
      const stmt = cachedPrepare(sql);
      return {
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
      };
    },
    transaction<T>(fn: () => T) {
      return rawDb.transaction(fn);
    },
    close() {
      rawDb.close();
    },
  };
}

function wrap(inner: SqliteInner): CodemapDatabase {
  return {
    run(sql: string, params?: BindValues) {
      runSql(inner, sql, params);
    },
    query<T>(sql: string) {
      const stmt = inner.query(sql);
      return {
        get(...params: unknown[]) {
          return stmt.get(...params) as T | undefined;
        },
        all(...params: unknown[]) {
          return stmt.all(...params) as T[];
        },
      };
    },
    transaction<T>(fn: () => T): () => T {
      return inner.transaction(fn) as () => T;
    },
    close() {
      inner.close();
    },
  };
}

export function openCodemapDatabase(path?: string): CodemapDatabase {
  const p = path ?? getDatabasePath();
  // Auto-create parent dir — <state-dir> may not exist on first run.
  if (p !== ":memory:") mkdirSync(dirname(p), { recursive: true });
  const db = wrap(openRaw(p));

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA case_sensitive_like = ON");
  db.run("PRAGMA temp_store = MEMORY");
  db.run("PRAGMA mmap_size = 268435456");
  db.run("PRAGMA cache_size = -16384");

  return db;
}
