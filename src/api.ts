import { resolve } from "node:path";

import { queryRows } from "./application/index-engine";
import { runCodemapIndex } from "./application/run-index";
import type { RunIndexOptions } from "./application/run-index";
import type { IndexResult } from "./application/types";
import { loadUserConfig, resolveCodemapConfig } from "./config";
import type { CodemapUserConfig } from "./config";
import { closeDb, openDb } from "./db";
import { configureResolver } from "./resolver";
import {
  getDatabasePath,
  getProjectRoot,
  getTsconfigPath,
  initCodemap,
} from "./runtime";

export type {
  IndexResult,
  IndexRunStats,
  IndexTableStats,
} from "./application/types";
export type { RunIndexOptions as IndexOptions } from "./application/run-index";

/**
 * Database handle returned by `openDb()`; use with {@link runCodemapIndex} in advanced scenarios.
 */
export type { CodemapDatabase } from "./db";

/**
 * Options for {@link createCodemap}.
 *
 * @property root - Project root. When omitted: `CODEMAP_ROOT` or `CODEMAP_TEST_BENCH`, then `process.cwd()`.
 * @property configFile - Explicit path to `.codemap/config.ts` or `.codemap/config.json` (same as CLI `--config`).
 * @property config - Inline overrides merged on top of the file-based config from the project root.
 */
export interface CodemapInitOptions {
  root?: string;
  configFile?: string;
  config?: CodemapUserConfig;
}

/**
 * Programmatic entry point: loads config, calls {@link initCodemap}, configures the import resolver,
 * and returns a {@link Codemap} handle.
 *
 * @remarks
 * Only one Codemap project per process: `initCodemap` is global; the last `createCodemap()` wins.
 */
export async function createCodemap(
  options: CodemapInitOptions = {},
): Promise<Codemap> {
  const envRoot = process.env.CODEMAP_ROOT ?? process.env.CODEMAP_TEST_BENCH;
  const root =
    options.root !== undefined
      ? resolve(options.root)
      : envRoot
        ? resolve(envRoot)
        : process.cwd();

  const loaded = await loadUserConfig(root, options.configFile);
  const merged: CodemapUserConfig = {
    ...loaded,
    ...options.config,
  };
  initCodemap(resolveCodemapConfig(root, merged));
  configureResolver(getProjectRoot(), getTsconfigPath());
  return new Codemap();
}

/**
 * Handle for SQL queries and index runs after {@link createCodemap}.
 *
 * Each {@link query} opens the database for that call; {@link index} manages its own open/close lifecycle.
 */
export class Codemap {
  /**
   * Absolute project root (from resolved config).
   */
  get root(): string {
    return getProjectRoot();
  }

  /**
   * Absolute path to the SQLite index file (e.g. `.codemap.db`).
   */
  get databasePath(): string {
    return getDatabasePath();
  }

  /**
   * Run a read-only SQL statement against the index (same semantics as the CLI `query` subcommand).
   *
   * @param sql - Valid SQLite for the Codemap schema.
   * @returns Result rows from `better-sqlite3`-style `.all()`.
   * @throws On invalid SQL or database errors (same as `better-sqlite3`).
   */
  query(sql: string): unknown[] {
    return queryRows(sql);
  }

  /**
   * Refresh the index: incremental (git-based), full, or targeted file list.
   *
   * @param options - See {@link RunIndexOptions}.
   */
  async index(options: RunIndexOptions = {}): Promise<IndexResult> {
    const db = openDb();
    try {
      return await runCodemapIndex(db, options);
    } finally {
      closeDb(db);
    }
  }
}

export { runCodemapIndex };
