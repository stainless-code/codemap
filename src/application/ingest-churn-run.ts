import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  META_CHURN_CONFIG_FINGERPRINT,
  META_CHURN_INDEXED_COMMIT,
  pruneFileChurnOrphans,
  replaceFileChurn,
  setMeta,
} from "../db";
import type { FileChurnRow } from "../db";
import type { CodemapDatabase } from "../sqlite-db";

export interface IngestChurnRunOk {
  ok: true;
  ingested: number;
  skipped_unindexed: number;
  sourcePath: string;
}

export interface IngestChurnRunError {
  ok: false;
  error: string;
}

export type IngestChurnRunResult = IngestChurnRunOk | IngestChurnRunError;

/** Strip inherited GIT_* so subprocess targets the project repo. */
function gitSpawnEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_")) continue;
    e[k] = v;
  }
  return e;
}

function parseChurnJsonPayload(raw: unknown): FileChurnRow[] {
  if (!Array.isArray(raw)) {
    throw new TypeError("churn JSON must be an array of file_churn rows");
  }
  const rows: FileChurnRow[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      throw new TypeError("each churn row must be an object");
    }
    const r = item as Record<string, unknown>;
    const file_path = r.file_path;
    if (typeof file_path !== "string" || file_path.length === 0) {
      throw new TypeError("file_path must be a non-empty string");
    }
    if (rows.some((existing) => existing.file_path === file_path)) {
      throw new TypeError(`duplicate file_path in churn JSON: ${file_path}`);
    }
    rows.push({
      file_path,
      commit_count: Number(r.commit_count) || 0,
      weighted_commits: Number(r.weighted_commits) || 0,
      lines_added: Number(r.lines_added) || 0,
      lines_removed: Number(r.lines_removed) || 0,
      last_commit_at:
        r.last_commit_at === null || r.last_commit_at === undefined
          ? null
          : String(r.last_commit_at),
      churn_trend:
        r.churn_trend === null || r.churn_trend === undefined
          ? null
          : String(r.churn_trend),
      computed_at:
        typeof r.computed_at === "string"
          ? r.computed_at
          : new Date().toISOString(),
    });
  }
  return rows;
}

/**
 * Load churn rows from JSON and replace `file_churn` (indexed paths only).
 * Used by `codemap ingest-churn` and config `churn.file` fallback.
 */
export function ingestChurnFromJsonFile(
  db: CodemapDatabase,
  options: { projectRoot: string; path: string },
): IngestChurnRunResult {
  const absPath = isAbsolute(options.path)
    ? options.path
    : resolve(options.projectRoot, options.path);
  if (!existsSync(absPath)) {
    return { ok: false, error: `churn file not found: ${absPath}` };
  }
  let rows: FileChurnRow[];
  try {
    rows = parseChurnJsonPayload(
      JSON.parse(readFileSync(absPath, "utf-8")) as unknown,
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const indexed = new Set(
    db
      .query<{ path: string }>("SELECT path FROM files")
      .all()
      .map((r) => r.path),
  );
  const kept: FileChurnRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!indexed.has(row.file_path)) {
      skipped += 1;
      continue;
    }
    kept.push(row);
  }

  if (kept.length === 0) {
    return {
      ok: false,
      error:
        rows.length === 0
          ? "churn JSON must contain at least one row"
          : `churn JSON has no rows for indexed files (${skipped} skipped)`,
    };
  }

  replaceFileChurn(db, kept);
  pruneFileChurnOrphans(db);
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: options.projectRoot,
    env: gitSpawnEnv(),
  });
  if (headResult.status === 0) {
    const head = headResult.stdout.toString().trim();
    if (head) {
      setMeta(db, META_CHURN_INDEXED_COMMIT, head);
      // JSON ingest has no half-life/since knobs — fingerprint marks manual import.
      setMeta(db, META_CHURN_CONFIG_FINGERPRINT, "json|");
    }
  }

  return {
    ok: true,
    ingested: kept.length,
    skipped_unindexed: skipped,
    sourcePath: absPath,
  };
}

/** Config `churn.file` ingest when git churn is unavailable. */
export function ingestChurnFromConfigPath(
  db: CodemapDatabase,
  options: { projectRoot: string; churnFile: string | null },
): IngestChurnRunResult | null {
  if (!options.churnFile) return null;
  return ingestChurnFromJsonFile(db, {
    projectRoot: options.projectRoot,
    path: options.churnFile,
  });
}
