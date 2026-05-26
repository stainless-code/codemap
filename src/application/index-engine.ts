import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { LANG_MAP } from "../constants";
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
  deleteSourceFtsBatch,
  insertFile,
  insertSymbols,
  insertImports,
  insertImportsWithSpecifiers,
  insertScopes,
  insertReferences,
  insertFileMetrics,
  insertFunctionParams,
  insertRuntimeMarkers,
  insertTestSuites,
  insertExports,
  insertComponents,
  insertDependencies,
  insertMarkers,
  insertSuppressions,
  insertCssVariables,
  insertCssClasses,
  insertCssKeyframes,
  insertTypeMembers,
  insertTypeHeritage,
  insertCalls,
  insertDynamicImports,
  insertAsyncCalls,
  insertTryCatchRows,
  getAllFileHashes,
  upsertSourceFts,
  META_FTS5_ENABLED_KEY,
  SCHEMA_VERSION,
} from "../db";
import type { CodemapDatabase, DynamicImportRow } from "../db";
import { filterRowsByChangedFiles } from "../git-changed";
import { globSync } from "../glob-sync";
import { hashContent } from "../hash";
import type { ParsedFile } from "../parse-worker";
import { resolveImports, resolveModuleSpecifier } from "../resolver";
import {
  getExcludeDirNames,
  getFts5Enabled,
  getIncludePatterns,
  getProjectRoot,
  getStateDir,
  isPathExcluded,
} from "../runtime";
import { parseFilesParallel } from "../worker-pool";
import { insertDecorators, insertJsdocTags } from "./behavioral-persist";
import {
  persistBindings,
  persistReExportChains,
  resolveBindings,
} from "./bindings-engine";
import { persistModuleCycles } from "./cycles-engine";
import { appendIndexError } from "./error-log";
import { persistFileBarrelFlags } from "./file-graph-flags";
import {
  persistTypeHeritageResolution,
  resolveTypeHeritage,
  expandHeritageResolveScope,
} from "./heritage-resolver";
import { persistJsxElementsAndAttributes } from "./jsx-persist";
import type { QueryBindValue } from "./query-engine";
import type {
  IndexPerformanceReport,
  IndexRunStats,
  IndexTableStats,
} from "./types";

export const VALID_EXTENSIONS = new Set(Object.keys(LANG_MAP));

function persistTierSubstrate(
  db: CodemapDatabase,
  relPath: string,
  data: Pick<
    ParsedFile,
    | "jsxElements"
    | "jsxAttributes"
    | "asyncCalls"
    | "tryCatchRows"
    | "decorators"
    | "jsdocTags"
  >,
) {
  if (data.jsxElements?.length || data.jsxAttributes?.length) {
    persistJsxElementsAndAttributes(
      db,
      data.jsxElements ?? [],
      data.jsxAttributes ?? [],
    );
  }
  if (data.asyncCalls?.length) insertAsyncCalls(db, data.asyncCalls);
  if (data.tryCatchRows?.length) insertTryCatchRows(db, data.tryCatchRows);
  if (data.decorators?.length) insertDecorators(db, relPath, data.decorators);
  if (data.jsdocTags?.length) insertJsdocTags(db, relPath, data.jsdocTags);
}

export function collectFiles(): string[] {
  const root = getProjectRoot();
  // Route excludeDirNames into the glob layer as `**/<name>/**` ignores —
  // tinyglobby prunes those subtrees up-front instead of walking + post-
  // filtering. isPathExcluded stays as defense-in-depth for paths that
  // somehow slip through (e.g. a future glob backend that ignores `ignore`).
  const ignore: string[] = [];
  for (const name of getExcludeDirNames()) ignore.push(`**/${name}/**`);
  const matches = globSync([...getIncludePatterns()], root, { ignore });
  const files: string[] = [];
  for (const path of matches) {
    if (isPathExcluded(path)) continue;
    files.push(path);
  }
  return [...new Set(files)].sort();
}

/** Reused between {@link getChangedFiles} and {@link indexFiles} so the incremental path reads + hashes each file once, not twice. */
export type ChangedSourceCache = Map<string, { source: string; hash: string }>;

function persistDynamicImports(
  db: CodemapDatabase,
  absPath: string,
  rows: DynamicImportRow[] | undefined,
): void {
  if (!rows?.length) return;
  for (const row of rows) {
    if (row.source_kind === "literal" && row.source_text) {
      row.resolved_path = resolveModuleSpecifier(absPath, row.source_text);
    }
  }
  insertDynamicImports(db, rows);
}

// Incremental indexing: `last_indexed_commit` must still be an ancestor of HEAD (otherwise
// history was rewritten — caller does a full rebuild). Union `git diff` (committed deltas
// since that commit) with `git status --porcelain` (staged + unstaged not in the diff alone).
// Filter to extensions we index; `stat` splits live files vs deletions.
export function getChangedFiles(db: CodemapDatabase): {
  changed: string[];
  deleted: string[];
  existingPaths: Set<string>;
  /** Source + hash for every entry in `changed[]`; reused by indexFiles to skip the second read+hash pass. */
  sourceCache: ChangedSourceCache;
  /** Existing `files.content_hash` map (all indexed paths) — reused by indexFiles to skip its own getAllFileHashes call. */
  existingHashes: Map<string, string>;
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
      ["diff", "--name-status", "-z", "--no-renames", `${lastCommit}..HEAD`],
      {
        cwd: root,
      },
    );
    const statusResult = spawnSync(
      "git",
      ["status", "--porcelain", "-z", "--no-renames"],
      {
        cwd: root,
      },
    );

    const diffDeletedFromCommit: string[] = [];
    const diffFiles: string[] = [];
    // --name-status -z records are STATUS NUL path NUL pairs (paths unquoted).
    const diffRecords = diffResult.stdout
      .toString()
      .split("\0")
      .filter(Boolean);
    for (let i = 0; i < diffRecords.length; i += 2) {
      const status = diffRecords[i];
      const path = diffRecords[i + 1];
      if (path === undefined) continue;
      if (status === "D") diffDeletedFromCommit.push(path);
      else diffFiles.push(path);
    }
    // Porcelain -z records are NUL-terminated; paths are unquoted (no C-style quoting).
    const statusFiles = statusResult.stdout
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((line: string) => line.slice(3));

    const existingHashes = getAllFileHashes(db);
    const allCandidates = [...new Set([...diffFiles, ...statusFiles])].filter(
      (f) => {
        const ext = extname(f).toLowerCase();
        return ext in LANG_MAP || existingHashes.has(f);
      },
    );

    const changed: string[] = [];
    const deleted: string[] = [];
    const sourceCache: ChangedSourceCache = new Map();

    for (const f of allCandidates) {
      const absPath = join(root, f);
      let source: string;
      try {
        source = readFileSync(absPath, "utf-8");
      } catch {
        deleted.push(f);
        continue;
      }
      const hash = hashContent(source);
      if (existingHashes.get(f) !== hash) {
        changed.push(f);
        sourceCache.set(f, { source, hash });
      }
    }

    const deletedAll = [...new Set([...deleted, ...diffDeletedFromCommit])];

    return {
      changed,
      deleted: deletedAll,
      existingPaths: new Set(existingHashes.keys()),
      sourceCache,
      existingHashes,
    };
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

function reportParseError(relPath: string, reason: string): void {
  console.error(`  Parse error in ${relPath}: ${reason}`);
  try {
    appendIndexError(getStateDir(), relPath, reason);
  } catch {
    // logging must not fail the index run
  }
}

function countParseFailures(results: readonly ParsedFile[]): number {
  let failures = 0;
  for (const parsed of results) {
    if (parsed.error || parsed.parseError) failures++;
  }
  return failures;
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
      if (parsed.error) {
        reportParseError(parsed.relPath, "file read failed");
        continue;
      }

      if (parsed.parseError) {
        reportParseError(parsed.relPath, parsed.parseError);
      }

      if (parsed.hasSideEffects) {
        parsed.fileRow.has_side_effects = parsed.hasSideEffects;
      }

      insertFile(db, parsed.fileRow);

      if (parsed.content !== undefined) {
        upsertSourceFts(db, parsed.fileRow.path, parsed.content);
      }

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
          const absPath = join(root, parsed.relPath);
          if (parsed.symbols?.length) insertSymbols(db, parsed.symbols);

          if (parsed.imports?.length || parsed.importSpecifiers?.length) {
            const deps = parsed.imports?.length
              ? resolveImports(absPath, parsed.imports, indexedPaths)
              : [];
            insertImportsWithSpecifiers(
              db,
              parsed.imports ?? [],
              parsed.importSpecifiers ?? [],
            );
            if (deps.length) insertDependencies(db, deps);
          }
          if (parsed.scopes?.length) insertScopes(db, parsed.scopes);
          if (parsed.references?.length)
            insertReferences(db, parsed.references);
          if (parsed.fileMetrics) insertFileMetrics(db, [parsed.fileMetrics]);
          if (parsed.functionParams?.length)
            insertFunctionParams(db, parsed.functionParams);
          if (parsed.runtimeMarkers?.length)
            insertRuntimeMarkers(db, parsed.runtimeMarkers);
          if (parsed.testSuites?.length)
            insertTestSuites(db, parsed.testSuites);

          if (parsed.exports?.length) insertExports(db, parsed.exports);
          if (parsed.components?.length) {
            insertComponents(db, parsed.components);
          }
          if (parsed.markers?.length) insertMarkers(db, parsed.markers);
          if (parsed.typeMembers?.length) {
            insertTypeMembers(db, parsed.typeMembers);
          }
          if (parsed.typeHeritage?.length) {
            insertTypeHeritage(db, parsed.typeHeritage);
          }
          if (parsed.calls?.length) insertCalls(db, parsed.calls);
          persistDynamicImports(db, absPath, parsed.dynamicImports);
          persistTierSubstrate(db, parsed.relPath, parsed);
        }
        if (parsed.suppressions?.length)
          insertSuppressions(db, parsed.suppressions);
      } catch (err) {
        reportParseError(
          parsed.relPath,
          err instanceof Error ? err.message : String(err),
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
        (SELECT COUNT(*) FROM type_heritage) as type_heritage,
        (SELECT COUNT(*) FROM calls) as calls,
        (SELECT COUNT(*) FROM css_variables) as css_vars,
        (SELECT COUNT(*) FROM css_classes) as css_classes,
        (SELECT COUNT(*) FROM css_keyframes) as css_keyframes,
        (SELECT COUNT(*) FROM scopes) as scopes,
        (SELECT COUNT(*) FROM "references") as "references",
        (SELECT COUNT(*) FROM bindings) as bindings,
        (SELECT COUNT(*) FROM import_specifiers) as import_specifiers,
        (SELECT COUNT(*) FROM function_params) as function_params,
        (SELECT COUNT(*) FROM runtime_markers) as runtime_markers,
        (SELECT COUNT(*) FROM test_suites) as test_suites,
        (SELECT COUNT(*) FROM re_export_chains) as re_export_chains,
        (SELECT COUNT(*) FROM module_cycles) as module_cycles,
        (SELECT COUNT(*) FROM dynamic_imports) as dynamic_imports,
        (SELECT COUNT(*) FROM file_metrics) as file_metrics`,
    )
    .get()!;
  return row as IndexTableStats;
}

export async function indexFiles(
  db: CodemapDatabase,
  filePaths: string[],
  fullRebuild: boolean,
  knownIndexedPaths?: Set<string>,
  options?: {
    quiet?: boolean;
    performance?: boolean;
    collectMs?: number;
    /** Skip `git rev-parse HEAD` and stamp this sha. See `RunIndexOptions.commit`. */
    commit?: string;
    /** When set, incremental branch skips the second readFileSync + hashContent per entry. Absent / sparse → inline read+hash. */
    sourceCache?: ChangedSourceCache;
    /** When set, incremental branch skips its own `getAllFileHashes(db)` call. */
    existingHashes?: Map<string, string>;
    /** When set, incremental branch deletes these paths inside the same transaction as re-indexing. */
    deletedPaths?: string[];
  },
): Promise<IndexRunStats> {
  const quiet = options?.quiet ?? false;
  const wantPerformance = options?.performance === true;
  const startTime = performance.now();
  let parseMs = 0;
  let insertMs = 0;
  let indexCreateMs = 0;
  let bindingsMs = 0;
  let heritageMs = 0;
  let moduleCyclesMs = 0;
  let reExportChainsMs = 0;
  let slowest: { path: string; parse_ms: number }[] = [];

  if (fullRebuild) {
    dropAll(db);
    createTables(db);
    db.run("PRAGMA synchronous = OFF");
    db.run("PRAGMA foreign_keys = OFF");
    // WAL is pure overhead during full rebuild — recovery is "rerun --full"
    // (rebuild starts with another dropAll). Restored post-bindings phase.
    db.run("PRAGMA journal_mode = OFF");
    // dropAll wiped meta; re-seed `fts5_enabled` + `schema_version` so the
    // next run's toggle-change detection has a reference point.
    setMeta(db, META_FTS5_ENABLED_KEY, getFts5Enabled() ? "1" : "0");
    setMeta(db, "schema_version", String(SCHEMA_VERSION));
  } else {
    createSchema(db);
  }
  const fts5WasEmpty =
    fullRebuild && getFts5Enabled() && !quiet && countFts5Rows(db) === 0;

  const indexedPaths = knownIndexedPaths ?? new Set(filePaths);

  let indexed = 0;
  let skipped = 0;
  let parseFailures = 0;
  let heritageScopePaths: string[] | undefined;

  if (fullRebuild) {
    const parseStart = performance.now();
    const results = await parseFilesParallel(filePaths);
    parseMs = performance.now() - parseStart;
    parseFailures = countParseFailures(results);
    // relPath is always POSIX-normalized ASCII (toRelativePosix upstream); byte order suffices
    // for architecture.md § Sorted inserts' B-tree locality and skips the Intl-collator tax.
    results.sort((a, b) =>
      a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
    );
    if (wantPerformance) {
      slowest = results
        .filter((r) => typeof r.parseMs === "number")
        .map((r) => ({ path: r.relPath, parse_ms: Math.round(r.parseMs!) }))
        .sort((a, b) => b.parse_ms - a.parse_ms)
        .slice(0, 10);
    }
    const insertStart = performance.now();
    indexed = insertParsedResults(db, results, indexedPaths);
    insertMs = performance.now() - insertStart;
    heritageScopePaths = undefined;
  } else {
    const existingHashes = options?.existingHashes ?? getAllFileHashes(db);
    const root = getProjectRoot();
    const sourceCache = options?.sourceCache;
    const toParse: string[] = [];
    const readFailed: string[] = [];

    for (const relPath of filePaths) {
      const absPath = join(root, relPath);
      let hash: string;
      const cached = sourceCache?.get(relPath);
      if (cached !== undefined) {
        hash = cached.hash;
      } else {
        try {
          hash = hashContent(readFileSync(absPath, "utf-8"));
        } catch {
          readFailed.push(relPath);
          continue;
        }
      }

      if (existingHashes.get(relPath) === hash) {
        skipped++;
      } else {
        toParse.push(relPath);
      }
    }

    const parseStart = performance.now();
    const parsedResults = await parseFilesParallel(toParse);
    parseMs = performance.now() - parseStart;
    parseFailures = countParseFailures(parsedResults);

    const transaction = db.transaction(() => {
      const deleted = options?.deletedPaths ?? [];
      if (deleted.length > 0) {
        deleteFilesFromIndex(db, deleted, quiet);
      }
      for (const relPath of readFailed) {
        deleteFileData(db, relPath);
      }
      for (const parsed of parsedResults) {
        deleteFileData(db, parsed.relPath);
      }
      indexed += insertParsedResults(db, parsedResults, indexedPaths);
    });

    transaction();
    heritageScopePaths = [
      ...parsedResults.map((p) => p.relPath),
      ...(options?.deletedPaths ?? []),
    ];
  }

  if (fullRebuild) {
    const idxStart = performance.now();
    createIndexes(db);
    indexCreateMs = performance.now() - idxStart;
    // PRAGMAs stay OFF through the bindings / cycles / re-exports phase
    // below — those steps insert another N rows per ref (~243k on a 2k-file
    // tree) and FK validation + fsync per row dominated bindings_ms by ~83%
    // pre-2026-05. Restored after the phase ends.
    setMeta(db, "schema_version", String(SCHEMA_VERSION));
  }

  setMeta(db, "last_indexed_commit", options?.commit ?? getCurrentCommit());
  setMeta(db, "indexed_at", new Date().toISOString());
  const fileCount = db
    .query<{ c: number }>("SELECT COUNT(*) as c FROM files")
    .get()!.c;
  setMeta(db, "file_count", String(fileCount));
  setMeta(db, "project_root", getProjectRoot());

  persistFileBarrelFlags(db);

  // Pass-2 binding resolution per R.12 — full-rebuild only to honor
  // R.10's <100ms targeted contract. Orphan-cleared until next full.
  if (fullRebuild) {
    const bindingsStart = performance.now();
    const bindings = resolveBindings(db);
    persistBindings(db, bindings);
    bindingsMs = performance.now() - bindingsStart;

    const cyclesStart = performance.now();
    persistModuleCycles(db);
    moduleCyclesMs = performance.now() - cyclesStart;

    const reExportStart = performance.now();
    persistReExportChains(db);
    reExportChainsMs = performance.now() - reExportStart;

    const heritageStart = performance.now();
    const heritageRows = resolveTypeHeritage(db);
    persistTypeHeritageResolution(db, heritageRows);
    heritageMs = performance.now() - heritageStart;

    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA journal_mode = WAL");
  } else if (heritageScopePaths && heritageScopePaths.length > 0) {
    const heritageStart = performance.now();
    const scope = expandHeritageResolveScope(db, heritageScopePaths);
    const heritageRows = resolveTypeHeritage(db, scope);
    persistTypeHeritageResolution(db, heritageRows);
    heritageMs = performance.now() - heritageStart;
  }

  const elapsed = Math.round(performance.now() - startTime);
  const stats = fetchTableStats(db);

  let perf: IndexPerformanceReport | undefined;
  if (wantPerformance) {
    const collectMs = Math.round(options?.collectMs ?? 0);
    perf = {
      collect_ms: collectMs,
      parse_ms: Math.round(parseMs),
      insert_ms: Math.round(insertMs),
      index_create_ms: Math.round(indexCreateMs),
      bindings_ms: Math.round(bindingsMs),
      module_cycles_ms: Math.round(moduleCyclesMs),
      re_export_chains_ms: Math.round(reExportChainsMs),
      heritage_ms: Math.round(heritageMs),
      total_ms: elapsed,
      slowest_files: slowest,
    };
    // Env-var output for scripts/check-perf-baseline.ts; absent var = no-op.
    const perfJsonPath = process.env.CODEMAP_PERFORMANCE_JSON;
    if (perfJsonPath !== undefined && perfJsonPath !== "") {
      try {
        writeFileSync(perfJsonPath, JSON.stringify(perf, null, 2));
      } catch (err) {
        console.error(
          `[performance] failed to write ${perfJsonPath}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  if (fts5WasEmpty && getFts5Enabled()) {
    const fts5Rows = countFts5Rows(db);
    if (fts5Rows > 0) {
      console.error(
        `[fts5] source_fts populated: ${fts5Rows} files / ${formatFts5SizeDelta(db)}`,
      );
    }
  }

  if (!quiet) {
    console.log(
      `\n  Codemap ${fullRebuild ? "(full rebuild)" : "(incremental)"}`,
    );
    console.log(
      `  ${indexed} files indexed, ${skipped} unchanged${parseFailures > 0 ? `, ${parseFailures} parse failures` : ""}, ${elapsed}ms`,
    );
    console.log(`  ───────────────────────────────────`);
    for (const [key, value] of Object.entries(stats)) {
      console.log(`  ${(key + ":").padEnd(14)}${value}`);
    }
    if (perf) {
      console.log(`  ───────────────────────────────────`);
      console.log(`  Performance breakdown (ms)`);
      console.log(`    collect:        ${perf.collect_ms}  (file glob)`);
      console.log(`    parse:          ${perf.parse_ms}  (workers)`);
      console.log(`    insert:         ${perf.insert_ms}  (bulk SQL)`);
      console.log(
        `    index_create:   ${perf.index_create_ms}  (B-tree build)`,
      );
      console.log(
        `    bindings:       ${perf.bindings_ms}  (resolveBindings + persist, full only)`,
      );
      console.log(
        `    module_cycles:  ${perf.module_cycles_ms}  (persistModuleCycles, full only)`,
      );
      console.log(
        `    re_exports:     ${perf.re_export_chains_ms}  (persistReExportChains, full only)`,
      );
      console.log(
        `    heritage:       ${perf.heritage_ms}  (resolveTypeHeritage + persist)`,
      );
      console.log(
        `    index_run:      ${perf.total_ms}  (parse + insert + index_create + DDL + bindings + cycles + re_exports)`,
      );
      if (perf.slowest_files.length > 0) {
        console.log(
          `  Top ${perf.slowest_files.length} slowest files (parse ms)`,
        );
        for (const f of perf.slowest_files) {
          console.log(`    ${String(f.parse_ms).padStart(5)}  ${f.path}`);
        }
      }
    }
    console.log();
  }

  return {
    indexed,
    skipped,
    elapsedMs: elapsed,
    fullRebuild,
    stats,
    performance: perf,
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
    // FK CASCADE doesn't reach `source_fts` (virtual table); mirror manually.
    deleteSourceFtsBatch(db, batch);
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
 *
 * When `opts.summary` is true, only the row count is emitted — `{"count": N}` with `--json`,
 * `count: N` otherwise. The SQL still executes against the index; `--summary` filters output, not work.
 *
 * When `opts.changedFiles` is provided, rows are post-filtered to those whose path columns
 * (`path`, `file_path`, `from_path`, `to_path`, `resolved_path`) match at least one entry.
 * Rows with no recognised path column pass through (the filter cannot decide; pair with `--summary`
 * if the count of changed-touching rows is what's wanted).
 *
 * When `opts.recipeActions` is provided AND `opts.json` is true, each row gets an `actions`
 * key set to the same template (recipe-only feature; ad-hoc SQL never carries actions).
 * Rows that already define their own `actions` column are not overwritten.
 * Sets `PRAGMA query_only = 1` so ad-hoc CLI SQL cannot mutate the index (mirrors `queryRows`).
 * @returns **0** on success, **1** on SQL/runtime error.
 */
export function printQueryResult(
  sql: string,
  opts?: {
    json?: boolean;
    summary?: boolean;
    changedFiles?: Set<string> | undefined;
    recipeActions?: ReadonlyArray<unknown> | undefined;
    bindValues?: QueryBindValue[] | undefined;
  },
): number {
  const json = opts?.json === true;
  const summary = opts?.summary === true;
  const changedFiles = opts?.changedFiles;
  const recipeActions = opts?.recipeActions;
  let db: CodemapDatabase | undefined;
  try {
    db = openDb();
    db.run("PRAGMA query_only = 1");
    let rows = db.query(sql).all(...(opts?.bindValues ?? []));
    if (changedFiles !== undefined) {
      rows = filterRowsByChangedFiles(rows, changedFiles);
    }
    if (summary) {
      if (json) {
        console.log(JSON.stringify({ count: rows.length }));
      } else {
        console.log(`count: ${rows.length}`);
      }
    } else if (json) {
      const enriched =
        recipeActions !== undefined && recipeActions.length > 0
          ? rows.map((row) => attachRecipeActions(row, recipeActions))
          : rows;
      console.log(JSON.stringify(enriched));
    } else if (rows.length === 0) {
      console.log("(no results)");
    } else {
      console.table(rows);
    }
    return 0;
  } catch (err) {
    const msg = enrichQueryError(
      err instanceof Error ? err.message : String(err),
    );
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

// Append the recipe's action template to a row without overwriting a pre-existing
// `actions` column from the SQL itself (recipe authors should never collide, but
// defensive: keep the SQL output authoritative).
function attachRecipeActions(
  row: unknown,
  actions: ReadonlyArray<unknown>,
): unknown {
  if (typeof row !== "object" || row === null) return row;
  const obj = row as Record<string, unknown>;
  if ("actions" in obj) return obj;
  return { ...obj, actions };
}

/**
 * Rewrites raw SQLite errors that almost always indicate a missing or empty
 * `.codemap.db` into an actionable hint. Other errors are returned unchanged.
 */
function enrichQueryError(message: string): string {
  if (
    /^no such table:\s*\w+/i.test(message) ||
    /^no such column:\s*\w+/i.test(message)
  ) {
    return `${message} — run \`codemap\` (or \`codemap --full\`) first to build the index, then re-run your query.`;
  }
  return message;
}

/**
 * Open the index, run SQL, return all rows, then close. Used by the public **`Codemap.query`** method.
 * Sets `PRAGMA query_only = 1` so DML/DDL slipping through programmatic `Codemap.query`,
 * `codemap apply` recipe SQL, the `cmd-query` paths, or `test:golden` errors at SQLite instead of mutating.
 * @throws On invalid SQL or database errors (same as `better-sqlite3`-style `.all()`).
 */
export function queryRows(
  sql: string,
  bindValues?: QueryBindValue[] | undefined,
): unknown[] {
  const db = openDb();
  try {
    db.run("PRAGMA query_only = 1");
    return db.query(sql).all(...(bindValues ?? []));
  } finally {
    closeDb(db, { readonly: true });
  }
}

function countFts5Rows(db: CodemapDatabase): number {
  const row = db
    .query<{ c: number }>("SELECT COUNT(*) AS c FROM source_fts")
    .get();
  return row?.c ?? 0;
}

/**
 * Best-effort FTS5 size telemetry. SQLite's `dbstat` virtual table requires
 * the SQLITE_ENABLE_DBSTAT_VTAB build flag (not always available); fall
 * back to file-bytes accounting via `sum(length(content))` so the line is
 * informational regardless of build flags. (`docs/plans/fts5-mermaid.md` Q7.)
 */
function formatFts5SizeDelta(db: CodemapDatabase): string {
  try {
    const row = db
      .query<{ b: number }>(
        "SELECT IFNULL(SUM(length(content)), 0) AS b FROM source_fts",
      )
      .get();
    const bytes = row?.b ?? 0;
    if (bytes < 1024) return `${bytes} B (uncompressed content)`;
    if (bytes < 1024 * 1024)
      return `${Math.round(bytes / 1024)} KB (uncompressed content)`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB (uncompressed content)`;
  } catch {
    return "size unknown";
  }
}
