import { createRequire } from "node:module";

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

type SqliteInner = {
  run(sql: string, params?: BindValues): void;
  query(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): unknown;
  close(): void;
};

function openRaw(path: string): SqliteInner {
  if (typeof Bun !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string, opts?: { create?: boolean }) => unknown;
    };
    return new Database(path, { create: true }) as SqliteInner;
  }

  type BetterSqlite = typeof import("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require("better-sqlite3") as BetterSqlite;
  const rawDb = new BetterSqlite(path);

  return {
    run(sql: string, params?: BindValues) {
      const stmt = rawDb.prepare(sql);
      if (params !== undefined && params.length > 0) {
        stmt.run(...params);
      } else {
        stmt.run();
      }
    },
    query(sql: string) {
      const stmt = rawDb.prepare(sql);
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
      if (params !== undefined && params.length > 0) {
        inner.run(sql, params);
      } else {
        inner.run(sql);
      }
    },
    query<T>(sql: string) {
      return {
        get(...params: unknown[]) {
          return inner.query(sql).get(...params) as T | undefined;
        },
        all(...params: unknown[]) {
          return inner.query(sql).all(...params) as T[];
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
