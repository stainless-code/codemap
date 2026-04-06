import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import fg from "fast-glob";

import { LANG_MAP } from "../constants";
import { extractCssData } from "../css-parser";
import {
  openDb,
  closeDb,
  createSchema,
  createTables,
  createIndexes,
  dropAll,
  getMeta,
  setMeta,
  deleteFileData,
  insertFile,
  insertSymbols,
  insertImports,
  insertExports,
  insertComponents,
  insertDependencies,
  insertMarkers,
  insertCssVariables,
  insertCssClasses,
  insertCssKeyframes,
  getAllFileHashes,
  SCHEMA_VERSION,
  type CodemapDatabase,
  type FileRow,
} from "../db";
import { hashContent } from "../hash";
import { extractMarkers } from "../markers";
import type { ParsedFile } from "../parse-worker";
import { extractFileData } from "../parser";
import { resolveImports } from "../resolver";
import { getIncludePatterns, getProjectRoot, isPathExcluded } from "../runtime";
import { parseFilesParallel } from "../worker-pool";
import type { IndexRunStats, IndexTableStats } from "./types";

export const VALID_EXTENSIONS = new Set(Object.keys(LANG_MAP));

const TS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const CSS_EXTENSIONS = new Set([".css"]);

function langFromExt(ext: string): string {
  return LANG_MAP[ext] ?? "text";
}

function fileCategory(path: string): "ts" | "css" | "text" {
  const ext = extname(path);
  if (TS_EXTENSIONS.has(ext)) return "ts";
  if (CSS_EXTENSIONS.has(ext)) return "css";
  return "text";
}

export function collectFiles(): string[] {
  const files: string[] = [];
  const root = getProjectRoot();
  for (const pattern of getIncludePatterns()) {
    const matches = fg.sync(pattern, {
      cwd: root,
      dot: true,
      absolute: false,
    });
    for (const path of matches) {
      if (isPathExcluded(path)) continue;
      files.push(path);
    }
  }
  return [...new Set(files)].sort();
}

export function getChangedFiles(db: CodemapDatabase): {
  changed: string[];
  deleted: string[];
} | null {
  const lastCommit = getMeta(db, "last_indexed_commit");
  if (!lastCommit) return null;

  try {
    const isAncestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", lastCommit, "HEAD"],
      {
        cwd: getProjectRoot(),
      },
    );
    if (isAncestor.status !== 0) return null;

    const diffResult = spawnSync(
      "git",
      ["diff", "--name-only", `${lastCommit}..HEAD`],
      {
        cwd: getProjectRoot(),
      },
    );
    const statusResult = spawnSync(
      "git",
      ["status", "--porcelain", "--no-renames"],
      {
        cwd: getProjectRoot(),
      },
    );

    const diffFiles = diffResult.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    const statusFiles = statusResult.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => line.slice(3).trim());

    const allChanged = [...new Set([...diffFiles, ...statusFiles])].filter(
      (f) => {
        const ext = extname(f);
        return ext in LANG_MAP;
      },
    );

    const changed: string[] = [];
    const deleted: string[] = [];

    for (const f of allChanged) {
      try {
        statSync(join(getProjectRoot(), f));
        changed.push(f);
      } catch {
        deleted.push(f);
      }
    }

    return { changed, deleted };
  } catch {
    return null;
  }
}

export function getCurrentCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: getProjectRoot(),
  });
  return result.stdout.toString().trim();
}

function insertParsedResults(
  db: CodemapDatabase,
  results: ParsedFile[],
  indexedPaths: Set<string>,
) {
  let indexed = 0;

  const transaction = db.transaction(() => {
    for (const parsed of results) {
      if (parsed.error) continue;

      insertFile(db, parsed.fileRow);

      try {
        if (parsed.category === "text") {
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);
        } else if (parsed.category === "css") {
          if (parsed.cssVariables?.length)
            insertCssVariables(db, parsed.cssVariables);
          if (parsed.cssClasses?.length)
            insertCssClasses(db, parsed.cssClasses);
          if (parsed.cssKeyframes?.length)
            insertCssKeyframes(db, parsed.cssKeyframes);
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);

          if (parsed.cssImportSources) {
            for (const importSource of parsed.cssImportSources) {
              insertImports(db, [
                {
                  file_path: parsed.relPath,
                  source: importSource,
                  resolved_path: null,
                  specifiers: "[]",
                  is_type_only: 0,
                  line_number: 0,
                },
              ]);
            }
          }
        } else {
          if (parsed.symbols?.length) insertSymbols(db, parsed.symbols);

          if (parsed.imports?.length) {
            const absPath = join(getProjectRoot(), parsed.relPath);
            const deps = resolveImports(absPath, parsed.imports, indexedPaths);
            insertImports(db, parsed.imports);
            if (deps.length) insertDependencies(db, deps);
          }

          if (parsed.exports?.length) insertExports(db, parsed.exports);
          if (parsed.components?.length)
            insertComponents(db, parsed.components);
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);
        }
      } catch (err) {
        console.error(
          `  Parse error in ${parsed.relPath}: ${err instanceof Error ? err.message : err}`,
        );
      }

      indexed++;
    }
  });

  transaction();
  return indexed;
}

function fetchTableStats(db: CodemapDatabase): IndexTableStats {
  const row = db
    .query<Record<string, number>>(
      `SELECT
        (SELECT COUNT(*) FROM files) as files,
        (SELECT COUNT(*) FROM symbols) as symbols,
        (SELECT COUNT(*) FROM imports) as imports,
        (SELECT COUNT(*) FROM exports) as exports,
        (SELECT COUNT(*) FROM components) as components,
        (SELECT COUNT(*) FROM dependencies) as dependencies,
        (SELECT COUNT(*) FROM markers) as markers,
        (SELECT COUNT(*) FROM css_variables) as css_vars,
        (SELECT COUNT(*) FROM css_classes) as css_classes,
        (SELECT COUNT(*) FROM css_keyframes) as css_keyframes`,
    )
    .get()!;
  return row as IndexTableStats;
}

export async function indexFiles(
  db: CodemapDatabase,
  filePaths: string[],
  fullRebuild: boolean,
  knownIndexedPaths?: Set<string>,
  options?: { quiet?: boolean },
): Promise<IndexRunStats> {
  const quiet = options?.quiet ?? false;
  const startTime = performance.now();

  if (fullRebuild) {
    dropAll(db);
    createTables(db);
    db.run("PRAGMA synchronous = OFF");
    db.run("PRAGMA foreign_keys = OFF");
  } else {
    createSchema(db);
  }

  const indexedPaths = knownIndexedPaths ?? new Set(filePaths);

  let indexed = 0;
  let skipped = 0;

  if (fullRebuild) {
    const results = await parseFilesParallel(filePaths);
    results.sort((a, b) => a.relPath.localeCompare(b.relPath));
    indexed = insertParsedResults(db, results, indexedPaths);
  } else {
    const existingHashes = getAllFileHashes(db);

    const transaction = db.transaction(() => {
      for (const relPath of filePaths) {
        const absPath = join(getProjectRoot(), relPath);
        let source: string;
        try {
          source = readFileSync(absPath, "utf-8");
        } catch {
          deleteFileData(db, relPath);
          continue;
        }

        const hash = hashContent(source);

        if (existingHashes.get(relPath) === hash) {
          skipped++;
          continue;
        }

        deleteFileData(db, relPath);

        const stat = statSync(absPath);
        let lineCount = 1;
        for (let i = 0; i < source.length; i++) {
          if (source.charCodeAt(i) === 10) lineCount++;
        }

        const fileRow: FileRow = {
          path: relPath,
          content_hash: hash,
          size: stat.size,
          line_count: lineCount,
          language: langFromExt(extname(relPath)),
          last_modified: Math.floor(stat.mtimeMs),
          indexed_at: Date.now(),
        };
        insertFile(db, fileRow);

        try {
          const category = fileCategory(relPath);

          if (category === "text") {
            const markers = extractMarkers(source, relPath);
            if (markers.length) insertMarkers(db, markers);
          } else if (category === "css") {
            const cssData = extractCssData(absPath, source, relPath);
            if (cssData.variables.length)
              insertCssVariables(db, cssData.variables);
            if (cssData.classes.length) insertCssClasses(db, cssData.classes);
            if (cssData.keyframes.length)
              insertCssKeyframes(db, cssData.keyframes);
            if (cssData.markers.length) insertMarkers(db, cssData.markers);
            for (const importSource of cssData.importSources) {
              insertImports(db, [
                {
                  file_path: relPath,
                  source: importSource,
                  resolved_path: null,
                  specifiers: "[]",
                  is_type_only: 0,
                  line_number: 0,
                },
              ]);
            }
          } else {
            const data = extractFileData(absPath, source, relPath);
            if (data.symbols.length) insertSymbols(db, data.symbols);
            const deps = resolveImports(absPath, data.imports, indexedPaths);
            if (data.imports.length) insertImports(db, data.imports);
            if (deps.length) insertDependencies(db, deps);
            if (data.exports.length) insertExports(db, data.exports);
            if (data.components.length) insertComponents(db, data.components);
            if (data.markers.length) insertMarkers(db, data.markers);
          }
        } catch (err) {
          console.error(
            `  Parse error in ${relPath}: ${err instanceof Error ? err.message : err}`,
          );
        }

        indexed++;
      }
    });

    transaction();
  }

  if (fullRebuild) {
    createIndexes(db);
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA foreign_keys = ON");
    setMeta(db, "schema_version", String(SCHEMA_VERSION));
  }

  setMeta(db, "last_indexed_commit", getCurrentCommit());
  setMeta(db, "indexed_at", new Date().toISOString());
  const fileCount = db
    .query<{ c: number }>("SELECT COUNT(*) as c FROM files")
    .get()!.c;
  setMeta(db, "file_count", String(fileCount));
  setMeta(db, "project_root", getProjectRoot());

  const elapsed = Math.round(performance.now() - startTime);
  const stats = fetchTableStats(db);

  if (!quiet) {
    console.log(
      `\n  Codemap ${fullRebuild ? "(full rebuild)" : "(incremental)"}`,
    );
    console.log(
      `  ${indexed} files indexed, ${skipped} unchanged, ${elapsed}ms`,
    );
    console.log(`  ───────────────────────────────────`);
    for (const [key, value] of Object.entries(stats)) {
      console.log(`  ${(key + ":").padEnd(14)}${value}`);
    }
    console.log();
  }

  return {
    indexed,
    skipped,
    elapsedMs: elapsed,
    fullRebuild,
    stats,
  };
}

export function deleteFilesFromIndex(
  db: CodemapDatabase,
  deleted: string[],
  quiet?: boolean,
) {
  if (deleted.length === 0) return;
  for (const f of deleted) {
    deleteFileData(db, f);
  }
  if (!quiet) {
    console.log(`  Removed ${deleted.length} deleted files from index`);
  }
}

export async function targetedReindex(
  db: CodemapDatabase,
  targetFiles: string[],
  quiet?: boolean,
) {
  const startTime = performance.now();
  createSchema(db);

  const existingPaths = new Set(getAllFileHashes(db).keys());
  for (const f of targetFiles) existingPaths.add(f);

  const elapsed = Math.round(performance.now() - startTime);
  if (!quiet) {
    console.log(
      `  Targeted reindex: ${targetFiles.length} files (setup ${elapsed}ms)`,
    );
  }

  return indexFiles(db, targetFiles, false, existingPaths, { quiet });
}

/**
 * Run SQL and print results to stdout (`console.table`), or a friendly error to stderr.
 * Does not throw on invalid SQL (matches CLI `query` UX).
 */
export function printQueryResult(sql: string): void {
  const db = openDb();
  try {
    const rows = db.query(sql).all();
    if (rows.length === 0) {
      console.log("(no results)");
    } else {
      console.table(rows);
    }
  } catch (err) {
    console.error(`Query error: ${err instanceof Error ? err.message : err}`);
  } finally {
    closeDb(db);
  }
}

/**
 * Open the index, run SQL, return all rows, then close (used by the public `Codemap.query` API).
 */
export function queryRows(sql: string): unknown[] {
  const db = openDb();
  try {
    return db.query(sql).all();
  } finally {
    closeDb(db);
  }
}
