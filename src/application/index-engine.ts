import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

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
  insertTypeMembers,
  insertCalls,
  getAllFileHashes,
  SCHEMA_VERSION,
  type CodemapDatabase,
  type FileRow,
} from "../db";
import { globSync } from "../glob-sync";
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
    const matches = globSync(pattern, root);
    for (const path of matches) {
      if (isPathExcluded(path)) continue;
      files.push(path);
    }
  }
  return [...new Set(files)].sort();
}

// Incremental indexing: `last_indexed_commit` must still be an ancestor of HEAD (otherwise
// history was rewritten — caller does a full rebuild). Union `git diff` (committed deltas
// since that commit) with `git status --porcelain` (staged + unstaged not in the diff alone).
// Filter to extensions we index; `stat` splits live files vs deletions.
export function getChangedFiles(db: CodemapDatabase): {
  changed: string[];
  deleted: string[];
  existingPaths: Set<string>;
} | null {
  const lastCommit = getMeta(db, "last_indexed_commit");
  if (!lastCommit) return null;

  try {
    const root = getProjectRoot();
    const isAncestor = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", lastCommit, "HEAD"],
      {
        cwd: root,
      },
    );
    if (isAncestor.status !== 0) return null;

    const diffResult = spawnSync(
      "git",
      ["diff", "--name-only", `${lastCommit}..HEAD`],
      {
        cwd: root,
      },
    );
    const statusResult = spawnSync(
      "git",
      ["status", "--porcelain", "--no-renames"],
      {
        cwd: root,
      },
    );

    const diffFiles = diffResult.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
    // Porcelain lines are `XY path` (two status chars + space); skip the prefix to get the path.
    const statusFiles = statusResult.stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => line.slice(3).trim());

    const existingHashes = getAllFileHashes(db);
    const allCandidates = [...new Set([...diffFiles, ...statusFiles])].filter(
      (f) => {
        const ext = extname(f);
        return ext in LANG_MAP || existingHashes.has(f);
      },
    );

    const changed: string[] = [];
    const deleted: string[] = [];

    for (const f of allCandidates) {
      const absPath = join(root, f);
      let source: string;
      try {
        source = readFileSync(absPath, "utf-8");
      } catch {
        deleted.push(f);
        continue;
      }
      if (existingHashes.get(f) !== hashContent(source)) {
        changed.push(f);
      }
    }

    return { changed, deleted, existingPaths: new Set(existingHashes.keys()) };
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
  const root = getProjectRoot();

  const transaction = db.transaction(() => {
    for (const parsed of results) {
      if (parsed.error) continue;

      insertFile(db, parsed.fileRow);

      try {
        if (parsed.category === "text") {
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);
        } else if (parsed.category === "css") {
          if (parsed.cssVariables?.length) {
            insertCssVariables(db, parsed.cssVariables);
          }
          if (parsed.cssClasses?.length) {
            insertCssClasses(db, parsed.cssClasses);
          }
          if (parsed.cssKeyframes?.length) {
            insertCssKeyframes(db, parsed.cssKeyframes);
          }
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);

          if (parsed.cssImportSources?.length) {
            insertImports(
              db,
              parsed.cssImportSources.map((importSource) => ({
                file_path: parsed.relPath,
                source: importSource,
                resolved_path: null,
                specifiers: "[]",
                is_type_only: 0,
                line_number: 0,
              })),
            );
          }
        } else {
          if (parsed.symbols?.length) insertSymbols(db, parsed.symbols);

          if (parsed.imports?.length) {
            const absPath = join(root, parsed.relPath);
            const deps = resolveImports(absPath, parsed.imports, indexedPaths);
            insertImports(db, parsed.imports);
            if (deps.length) insertDependencies(db, deps);
          }

          if (parsed.exports?.length) insertExports(db, parsed.exports);
          if (parsed.components?.length) {
            insertComponents(db, parsed.components);
          }
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);
          if (parsed.typeMembers?.length) {
            insertTypeMembers(db, parsed.typeMembers);
          }
          if (parsed.calls?.length) insertCalls(db, parsed.calls);
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

export function fetchTableStats(db: CodemapDatabase): IndexTableStats {
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
        (SELECT COUNT(*) FROM type_members) as type_members,
        (SELECT COUNT(*) FROM calls) as calls,
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
    const root = getProjectRoot();

    const transaction = db.transaction(() => {
      for (const relPath of filePaths) {
        const absPath = join(root, relPath);
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
            if (cssData.variables.length) {
              insertCssVariables(db, cssData.variables);
            }
            if (cssData.classes.length) insertCssClasses(db, cssData.classes);
            if (cssData.keyframes.length) {
              insertCssKeyframes(db, cssData.keyframes);
            }
            if (cssData.markers.length) insertMarkers(db, cssData.markers);
            if (cssData.importSources.length) {
              insertImports(
                db,
                cssData.importSources.map((importSource) => ({
                  file_path: relPath,
                  source: importSource,
                  resolved_path: null,
                  specifiers: "[]",
                  is_type_only: 0,
                  line_number: 0,
                })),
              );
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
            if (data.typeMembers.length)
              insertTypeMembers(db, data.typeMembers);
            if (data.calls.length) insertCalls(db, data.calls);
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
  const CHUNK = 500;
  for (let i = 0; i < deleted.length; i += CHUNK) {
    const batch = deleted.slice(i, i + CHUNK);
    const placeholders = batch.map(() => "?").join(",");
    db.run(`DELETE FROM files WHERE path IN (${placeholders})`, batch);
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
 * Run read-only SQL and print results to stdout (`console.table`, or JSON when `opts.json`).
 * Does not throw on invalid SQL: prints an error and returns **1** (CLI-style). With **`json`**, errors are printed as **`{"error":"<message>"}`** on stdout.
 * @returns **0** on success, **1** on SQL/runtime error.
 */
export function printQueryResult(
  sql: string,
  opts?: { json?: boolean },
): number {
  const json = opts?.json === true;
  let db: CodemapDatabase | undefined;
  try {
    db = openDb();
    const rows = db.query(sql).all();
    if (json) {
      console.log(JSON.stringify(rows));
    } else if (rows.length === 0) {
      console.log("(no results)");
    } else {
      console.table(rows);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(`Query error: ${msg}`);
    }
    return 1;
  } finally {
    if (db !== undefined) closeDb(db, { readonly: true });
  }
}

/**
 * Open the index, run SQL, return all rows, then close. Used by the public **`Codemap.query`** method.
 * @throws On invalid SQL or database errors (same as `better-sqlite3`-style `.all()`).
 */
export function queryRows(sql: string): unknown[] {
  const db = openDb();
  try {
    return db.query(sql).all();
  } finally {
    closeDb(db, { readonly: true });
  }
}
