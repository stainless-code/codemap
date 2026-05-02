import {
  getCurrentCommit,
  printQueryResult,
  queryRows,
} from "../application/index-engine";
import {
  getQueryRecipeActions,
  getQueryRecipeSql,
  listQueryRecipeCatalog,
  listQueryRecipeIds,
  QUERY_RECIPES,
} from "../application/query-recipes";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import {
  closeDb,
  deleteQueryBaseline,
  getQueryBaseline,
  listQueryBaselines,
  openDb,
  upsertQueryBaseline,
} from "../db";
import { diffRows } from "../diff-rows";
import { filterRowsByChangedFiles, getFilesChangedSince } from "../git-changed";
import type { Bucketizer, GroupByMode } from "../group-by";
import {
  discoverWorkspaceRoots,
  firstDirectory,
  GROUP_BY_MODES,
  groupRowsBy,
  isGroupByMode,
  loadCodeowners,
  makePackageBucketizer,
} from "../group-by";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"query"`.
 * Supports `--json`, `--recipe <id>`, `--recipes-json`, `--print-sql <id>`, and raw SQL (see {@link printQueryCmdHelp}).
 */
export function parseQueryRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      sql: string;
      json: boolean;
      summary: boolean;
      changedSince: string | undefined;
      recipeId: string | undefined;
      groupBy: GroupByMode | undefined;
      saveBaseline: string | true | undefined;
      baseline: string | true | undefined;
    }
  | { kind: "recipesCatalog" }
  | { kind: "printRecipeSql"; id: string }
  | { kind: "listBaselines"; json: boolean }
  | { kind: "dropBaseline"; name: string; json: boolean } {
  if (rest[0] !== "query") {
    throw new Error("parseQueryRest: expected query");
  }
  if (rest.length === 1) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] [--summary] [--changed-since <ref>] [--group-by <mode>] "<SQL>" | codemap query [...] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id>\nRun codemap query --help for more.',
    };
  }

  let i = 1;
  let json = false;
  let summary = false;
  let changedSince: string | undefined;
  let recipeId: string | undefined;
  let recipesJson = false;
  let printSqlId: string | undefined;
  let groupBy: GroupByMode | undefined;
  let listBaselines = false;
  let dropBaselineName: string | undefined;
  let saveBaseline: string | true | undefined;
  let baseline: string | true | undefined;

  while (i < rest.length) {
    const a = rest[i];
    if (a === "--help" || a === "-h") {
      return { kind: "help" };
    }
    if (a === "--json") {
      json = true;
      i++;
      continue;
    }
    if (a === "--summary") {
      summary = true;
      i++;
      continue;
    }
    if (a === "--changed-since") {
      const ref = rest[i + 1];
      if (ref === undefined || ref.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap: "--changed-since" requires a git ref. Example: codemap query --changed-since origin/main -r fan-out',
        };
      }
      changedSince = ref;
      i += 2;
      continue;
    }
    if (a === "--group-by") {
      const mode = rest[i + 1];
      if (mode === undefined || mode.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap: "--group-by" requires a mode (${GROUP_BY_MODES.join(" | ")}).`,
        };
      }
      if (!isGroupByMode(mode)) {
        return {
          kind: "error",
          message: `codemap: unknown --group-by mode "${mode}". Known modes: ${GROUP_BY_MODES.join(", ")}.`,
        };
      }
      groupBy = mode;
      i += 2;
      continue;
    }
    if (a === "--save-baseline" || a.startsWith("--save-baseline=")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const v = a.slice(eq + 1);
        if (!v) {
          return {
            kind: "error",
            message:
              'codemap: "--save-baseline=<name>" requires a non-empty name. Drop the "=" to use the recipe id as the default name.',
          };
        }
        saveBaseline = v;
        i++;
        continue;
      }
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        saveBaseline = next;
        i += 2;
        continue;
      }
      saveBaseline = true;
      i++;
      continue;
    }
    if (a === "--baseline" || a.startsWith("--baseline=")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const v = a.slice(eq + 1);
        if (!v) {
          return {
            kind: "error",
            message:
              'codemap: "--baseline=<name>" requires a non-empty name. Drop the "=" to use the recipe id as the default name.',
          };
        }
        baseline = v;
        i++;
        continue;
      }
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        baseline = next;
        i += 2;
        continue;
      }
      baseline = true;
      i++;
      continue;
    }
    if (a === "--baselines") {
      listBaselines = true;
      i++;
      continue;
    }
    if (a === "--drop-baseline") {
      const name = rest[i + 1];
      if (name === undefined || name.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap: "--drop-baseline" requires a name. Example: codemap query --drop-baseline pre-refactor',
        };
      }
      dropBaselineName = name;
      i += 2;
      continue;
    }
    if (a === "--recipes-json") {
      recipesJson = true;
      i++;
      continue;
    }
    if (a === "--print-sql") {
      const name = rest[i + 1];
      if (name === undefined || name.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap: "--print-sql" requires a recipe id. Example: codemap query --print-sql fan-out',
        };
      }
      printSqlId = name;
      i += 2;
      continue;
    }
    if (a === "--recipe" || a === "-r") {
      const name = rest[i + 1];
      if (name === undefined || name.startsWith("-")) {
        return {
          kind: "error",
          message: `codemap: "${a}" requires a recipe id. Example: codemap query ${a} fan-out`,
        };
      }
      recipeId = name;
      i += 2;
      continue;
    }
    break;
  }

  if (recipesJson) {
    if (recipeId !== undefined || printSqlId !== undefined) {
      return {
        kind: "error",
        message:
          "codemap: --recipes-json cannot be combined with --recipe or --print-sql.",
      };
    }
    if (i < rest.length) {
      return {
        kind: "error",
        message:
          "codemap: --recipes-json does not take SQL or extra arguments.",
      };
    }
    return { kind: "recipesCatalog" };
  }

  if (listBaselines) {
    if (
      recipeId !== undefined ||
      printSqlId !== undefined ||
      saveBaseline !== undefined ||
      baseline !== undefined ||
      dropBaselineName !== undefined ||
      summary ||
      changedSince !== undefined ||
      groupBy !== undefined ||
      i < rest.length
    ) {
      return {
        kind: "error",
        message:
          "codemap: --baselines is a list-only operation; it does not take SQL or any other --recipe / --save-baseline / --baseline / --drop-baseline / --summary / --changed-since / --group-by flag.",
      };
    }
    return { kind: "listBaselines", json };
  }

  if (dropBaselineName !== undefined) {
    if (
      recipeId !== undefined ||
      printSqlId !== undefined ||
      saveBaseline !== undefined ||
      baseline !== undefined ||
      summary ||
      changedSince !== undefined ||
      groupBy !== undefined ||
      i < rest.length
    ) {
      return {
        kind: "error",
        message:
          "codemap: --drop-baseline only takes a name; it does not compose with SQL or any other --recipe / --save-baseline / --baseline / --summary / --changed-since / --group-by flag.",
      };
    }
    return { kind: "dropBaseline", name: dropBaselineName, json };
  }

  if (saveBaseline !== undefined && baseline !== undefined) {
    return {
      kind: "error",
      message:
        "codemap: --save-baseline and --baseline are mutually exclusive in one run.",
    };
  }
  if (
    groupBy !== undefined &&
    (saveBaseline !== undefined || baseline !== undefined)
  ) {
    return {
      kind: "error",
      message:
        "codemap: --group-by cannot be combined with --save-baseline or --baseline (different output shapes).",
    };
  }

  if (printSqlId !== undefined) {
    if (recipeId !== undefined) {
      return {
        kind: "error",
        message: "codemap: use either --recipe or --print-sql, not both.",
      };
    }
    if (i < rest.length) {
      return {
        kind: "error",
        message:
          "codemap: --print-sql does not take a SQL string; only the recipe id.",
      };
    }
    const sql = getQueryRecipeSql(printSqlId);
    if (sql === undefined) {
      const known = listQueryRecipeIds().join(", ");
      return {
        kind: "error",
        message: `codemap: unknown recipe "${printSqlId}". Known recipes: ${known}`,
      };
    }
    return { kind: "printRecipeSql", id: printSqlId };
  }

  if (recipeId !== undefined) {
    if (i < rest.length) {
      return {
        kind: "error",
        message:
          "codemap: --recipe does not take a SQL string; remove arguments after the recipe id.",
      };
    }
    const sql = getQueryRecipeSql(recipeId);
    if (sql === undefined) {
      const known = listQueryRecipeIds().join(", ");
      return {
        kind: "error",
        message: `codemap: unknown recipe "${recipeId}". Known recipes: ${known}`,
      };
    }
    return {
      kind: "run",
      sql,
      json,
      summary,
      changedSince,
      recipeId,
      groupBy,
      saveBaseline,
      baseline,
    };
  }

  const sql = rest.slice(i).join(" ").trim();
  if (!sql) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] [--summary] [--changed-since <ref>] [--group-by <mode>] [--save-baseline[=<name>] | --baseline[=<name>]] "<SQL>" | codemap query [...] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id> | codemap query --baselines | codemap query --drop-baseline <name>',
    };
  }
  // Ad-hoc SQL needs an explicit baseline name (no recipe id default).
  if (saveBaseline === true) {
    return {
      kind: "error",
      message:
        'codemap: "--save-baseline" needs an explicit name when used without --recipe (recipe id is the default name otherwise). Use --save-baseline=<name>.',
    };
  }
  if (baseline === true) {
    return {
      kind: "error",
      message:
        'codemap: "--baseline" needs an explicit name when used without --recipe. Use --baseline=<name>.',
    };
  }
  return {
    kind: "run",
    sql,
    json,
    summary,
    changedSince,
    recipeId: undefined,
    groupBy,
    saveBaseline,
    baseline,
  };
}

/** Print the bundled recipe catalog as JSON to stdout (no DB access). */
export function printRecipesCatalogJson(): void {
  console.log(JSON.stringify(listQueryRecipeCatalog(), null, 2));
}

/** Print one recipe's SQL to stdout, or false if the id is unknown (caller should exit 1). */
export function printRecipeSqlToStdout(id: string): boolean {
  const sql = getQueryRecipeSql(id);
  if (sql === undefined) {
    return false;
  }
  console.log(sql);
  return true;
}

function formatRecipeHelpLines(): string {
  const ids = listQueryRecipeIds();
  const width = ids.reduce((n, id) => Math.max(n, id.length), 0);
  const lines = ids.map((id) => {
    const meta = QUERY_RECIPES[id];
    const desc = meta?.description ?? "";
    return `    ${id.padEnd(width)}  ${desc}`;
  });
  return lines.join("\n");
}

/**
 * Print **`codemap query`** usage, flags, and bundled recipe ids to stdout.
 */
export function printQueryCmdHelp(): void {
  const recipeBlock = formatRecipeHelpLines();
  console.log(`Usage: codemap query [--json] [--summary] [--changed-since <ref>] [--group-by <mode>] [--save-baseline[=<name>] | --baseline[=<name>]] "<SQL>"
       codemap query [...] --recipe <id>   (alias: -r)
       codemap query --recipes-json
       codemap query --print-sql <id>
       codemap query --baselines
       codemap query --drop-baseline <name>

Read-only SQL against .codemap.db (after at least one successful index run).
The CLI does not cap row count — use SQL LIMIT (and ORDER BY) when you need a bounded result set.

Flags:
  --json                  Print a JSON array of row objects to stdout (for agents and scripts).
                          On error, prints a single object: {"error":"<message>"} to stdout.
  --summary               Print only the row count (no rows). With --json: {"count": N}. Without: count: N.
                          With --group-by, output collapses to {"group_by": "<mode>", "groups": [{key, count}]}.
                          With --baseline, collapses to {baseline, current_row_count, added: N, removed: N}.
                          Useful for dashboards and agent context windows where the rows are noise.
  --changed-since <ref>   Filter result rows to those touching files changed since <ref>. The ref can be
                          any committish (origin/main, HEAD~5, a sha, a tag). Rows are kept if any of
                          path / file_path / from_path / to_path / resolved_path matches the changed set.
                          Rows with no path column pass through (pair with --summary if a count matters).
  --group-by <mode>       Partition result rows by mode = owner | directory | package and print as
                          {"group_by": "<mode>", "groups": [{key, count, rows}]} (with --json) or a
                          two-column table (without). Mode definitions:
                            owner     CODEOWNERS first-listed owner (last matching rule wins).
                                      Looked up in .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS.
                            directory First path segment (src/cli/foo.ts → src).
                            package   Workspace dir from package.json/workspaces or pnpm-workspace.yaml;
                                      out-of-workspace paths bucket to "<root>".
  --save-baseline[=<name>]
                          Snapshot the result rows to the query_baselines table inside .codemap.db
                          for later --baseline diffs. Name defaults to the --recipe id; ad-hoc SQL
                          must pass an explicit =<name>. Stores SQL, rows, row count, current git
                          HEAD (when available), and a timestamp. Re-saving with the same name
                          overwrites in place. Survives --full and SCHEMA_VERSION rebuilds.
  --baseline[=<name>]     Diff the current result against the saved baseline of the same name.
                          Output: {baseline:{...}, current_row_count, added: [...], removed: [...]}
                          (with --json) or a two-section terminal dump. Set membership uses
                          JSON.stringify(row) — exact-match identity, no fuzzy "changed" category.
                          Recipe actions, when defined, attach to the added rows only.
  --baselines             List saved baselines (name, recipe_id, row_count, git_ref, created_at).
  --drop-baseline <name>  Delete a saved baseline. Exits 1 if the name doesn't exist.
  --recipe, -r <id>       Run bundled SQL (no SQL string on the command line).
  --recipes-json          Print all bundled recipes (id, description, sql) as JSON to stdout. No DB.
  --print-sql <id>        Print one recipe's SQL text to stdout (does not run the query). No DB.
  --help, -h              Show this help.

Bundled recipes:
${recipeBlock}

Examples:
  # Ad-hoc SQL
  codemap query "SELECT name, file_path FROM symbols LIMIT 10"
  codemap query --json "SELECT COUNT(*) AS n FROM symbols"

  # Bundled recipe (full flag and short alias)
  codemap query --recipe fan-out
  codemap query -r fan-out
  codemap query --json -r deprecated-symbols

  # Counts only (skip the rows)
  codemap query --json --summary -r deprecated-symbols
  codemap query --summary "SELECT * FROM symbols WHERE doc_comment LIKE '%@todo%'"

  # PR-scoped: rows touching files changed since main
  codemap query --json --changed-since origin/main -r fan-out
  codemap query --json --summary --changed-since HEAD~5 "SELECT file_path FROM symbols"

  # Group by directory / owner / workspace package
  codemap query --json --group-by directory -r fan-in
  codemap query --json --summary --group-by owner -r deprecated-symbols
  codemap query --json --summary --group-by package "SELECT file_path FROM symbols"

  # Snapshot a result, refactor, then diff
  codemap query --save-baseline -r visibility-tags          # save under name "visibility-tags"
  # ... refactor ...
  codemap query --json --baseline -r visibility-tags        # full diff
  codemap query --json --summary --baseline -r visibility-tags   # counts only
  codemap query --save-baseline=pre-refactor "SELECT name, file_path FROM symbols WHERE visibility = 'beta'"
  codemap query --baseline=pre-refactor "SELECT name, file_path FROM symbols WHERE visibility = 'beta'"
  codemap query --baselines                                 # list
  codemap query --drop-baseline pre-refactor                # delete

  # Inspect recipes without touching the DB
  codemap query --recipes-json
  codemap query --print-sql fan-out
`);
}

/**
 * Initialize Codemap for `opts.root`, then run **`printQueryResult`**.
 * Sets **`process.exitCode`** on failure (no **`process.exit`**). With **`--json`**, bootstrap errors print **`{"error":"…"}`** on stdout like query failures.
 */
export async function runQueryCmd(opts: {
  root: string;
  configFile: string | undefined;
  sql: string;
  json?: boolean;
  summary?: boolean;
  changedSince?: string | undefined;
  recipeId?: string | undefined;
  groupBy?: GroupByMode | undefined;
  saveBaseline?: string | true | undefined;
  baseline?: string | true | undefined;
}): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());

    let changedFiles: Set<string> | undefined;
    if (opts.changedSince !== undefined) {
      const result = getFilesChangedSince(opts.changedSince, getProjectRoot());
      if (!result.ok) {
        emitErrorMaybeJson(result.error, opts.json);
        return;
      }
      changedFiles = result.files;
    }

    const recipeActions =
      opts.recipeId !== undefined
        ? getQueryRecipeActions(opts.recipeId)
        : undefined;

    // Baseline ops branch off here — they don't compose with --group-by because
    // the diff semantics are about row identity, not bucketing. (--summary still
    // composes: collapses the diff to {added: N, removed: N}.)
    if (opts.saveBaseline !== undefined) {
      runSaveBaseline({
        sql: opts.sql,
        json: opts.json === true,
        recipeId: opts.recipeId,
        baselineName:
          opts.saveBaseline === true
            ? (opts.recipeId as string)
            : opts.saveBaseline,
        changedFiles,
      });
      return;
    }
    if (opts.baseline !== undefined) {
      runBaselineDiff({
        sql: opts.sql,
        json: opts.json === true,
        summary: opts.summary === true,
        baselineName:
          opts.baseline === true ? (opts.recipeId as string) : opts.baseline,
        changedFiles,
        recipeActions,
      });
      return;
    }

    if (opts.groupBy !== undefined) {
      runGroupedQuery({
        sql: opts.sql,
        json: opts.json === true,
        summary: opts.summary === true,
        groupBy: opts.groupBy,
        changedFiles,
        recipeActions,
        root: getProjectRoot(),
      });
      return;
    }

    const code = printQueryResult(opts.sql, {
      json: opts.json,
      summary: opts.summary,
      changedFiles,
      recipeActions,
    });
    if (code !== 0) process.exitCode = code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

/** Bootstrap a DB connection and run the list-baselines command. */
export async function runListBaselinesCmd(opts: {
  root: string;
  configFile: string | undefined;
  json: boolean;
}): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());
    const db = openDb();
    try {
      const rows = listQueryBaselines(db);
      if (opts.json) {
        console.log(JSON.stringify(rows));
      } else if (rows.length === 0) {
        console.log("(no baselines)");
      } else {
        console.table(rows);
      }
    } finally {
      closeDb(db, { readonly: true });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

/** Bootstrap a DB connection and drop the named baseline; exits 1 on miss. */
export async function runDropBaselineCmd(opts: {
  root: string;
  configFile: string | undefined;
  name: string;
  json: boolean;
}): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());
    const db = openDb();
    try {
      const dropped = deleteQueryBaseline(db, opts.name);
      if (!dropped) {
        emitErrorMaybeJson(
          `codemap: no baseline named "${opts.name}". Use --baselines to list saved baselines.`,
          opts.json,
        );
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({ dropped: opts.name }));
      } else {
        console.log(`Dropped baseline: ${opts.name}`);
      }
    } finally {
      closeDb(db);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitErrorMaybeJson(msg, opts.json);
  }
}

function emitErrorMaybeJson(message: string, json: boolean | undefined) {
  if (json === true) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function runGroupedQuery(opts: {
  sql: string;
  json: boolean;
  summary: boolean;
  groupBy: GroupByMode;
  changedFiles: Set<string> | undefined;
  recipeActions: ReadonlyArray<unknown> | undefined;
  root: string;
}) {
  let bucketize: Bucketizer;
  if (opts.groupBy === "owner") {
    const ownerBucketize = loadCodeowners(opts.root);
    if (ownerBucketize === null) {
      emitErrorMaybeJson(
        "--group-by owner: no CODEOWNERS file found (looked in .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS).",
        opts.json,
      );
      return;
    }
    bucketize = ownerBucketize;
  } else if (opts.groupBy === "package") {
    const roots = discoverWorkspaceRoots(opts.root);
    bucketize = makePackageBucketizer(roots);
  } else {
    bucketize = (path: string) => firstDirectory(path);
  }

  let rows: unknown[];
  try {
    rows = queryRows(opts.sql);
  } catch (err) {
    emitErrorMaybeJson(
      err instanceof Error ? err.message : String(err),
      opts.json,
    );
    return;
  }

  if (opts.changedFiles !== undefined) {
    rows = filterRowsByChangedFiles(rows, opts.changedFiles);
  }

  const enriched =
    opts.recipeActions !== undefined && opts.recipeActions.length > 0
      ? rows.map((row) => attachActionsForGrouped(row, opts.recipeActions!))
      : rows;

  const noBucketLabel = opts.groupBy === "owner" ? "<no-owner>" : "<unknown>";
  const grouped = groupRowsBy(enriched, bucketize, noBucketLabel);

  if (opts.json) {
    if (opts.summary) {
      console.log(
        JSON.stringify({
          group_by: opts.groupBy,
          groups: grouped.map((g) => ({ key: g.key, count: g.count })),
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          group_by: opts.groupBy,
          groups: grouped,
        }),
      );
    }
    return;
  }

  if (grouped.length === 0) {
    console.log("(no results)");
    return;
  }
  if (opts.summary) {
    console.log(`group_by: ${opts.groupBy}`);
    for (const g of grouped) console.log(`  ${g.key}: ${g.count}`);
    return;
  }
  console.log(`group_by: ${opts.groupBy}`);
  console.table(grouped.map((g) => ({ key: g.key, count: g.count })));
}

function attachActionsForGrouped(
  row: unknown,
  actions: ReadonlyArray<unknown>,
): unknown {
  if (typeof row !== "object" || row === null) return row;
  const obj = row as Record<string, unknown>;
  if ("actions" in obj) return obj;
  return { ...obj, actions };
}

// `git rev-parse HEAD` may legitimately fail (no git, detached worktree, etc.).
// Baselines just record git_ref = NULL in that case — no fatal error.
function tryGetGitRef(): string | null {
  try {
    const sha = getCurrentCommit();
    return sha || null;
  } catch {
    return null;
  }
}

function runSaveBaseline(opts: {
  sql: string;
  json: boolean;
  recipeId: string | undefined;
  baselineName: string;
  changedFiles: Set<string> | undefined;
}) {
  let rows: unknown[];
  try {
    rows = queryRows(opts.sql);
  } catch (err) {
    emitErrorMaybeJson(
      err instanceof Error ? err.message : String(err),
      opts.json,
    );
    return;
  }
  if (opts.changedFiles !== undefined) {
    rows = filterRowsByChangedFiles(rows, opts.changedFiles);
  }

  const db = openDb();
  let savedAt: number;
  let gitRef: string | null;
  try {
    savedAt = Date.now();
    gitRef = tryGetGitRef();
    upsertQueryBaseline(db, {
      name: opts.baselineName,
      recipe_id: opts.recipeId ?? null,
      sql: opts.sql,
      rows_json: JSON.stringify(rows),
      row_count: rows.length,
      git_ref: gitRef,
      created_at: savedAt,
    });
  } finally {
    closeDb(db);
  }

  if (opts.json) {
    console.log(
      JSON.stringify({
        saved: opts.baselineName,
        recipe_id: opts.recipeId ?? null,
        row_count: rows.length,
        git_ref: gitRef,
        created_at: savedAt,
      }),
    );
  } else {
    const ref = gitRef ? ` @ ${gitRef.slice(0, 8)}` : "";
    console.log(
      `Saved baseline "${opts.baselineName}" (${rows.length} rows${ref}).`,
    );
  }
}

interface BaselineDiff {
  baseline: {
    name: string;
    recipe_id: string | null;
    row_count: number;
    git_ref: string | null;
    created_at: number;
  };
  current_row_count: number;
  added: unknown[];
  removed: unknown[];
}

function runBaselineDiff(opts: {
  sql: string;
  json: boolean;
  summary: boolean;
  baselineName: string;
  changedFiles: Set<string> | undefined;
  recipeActions: ReadonlyArray<unknown> | undefined;
}) {
  const db = openDb();
  let baseline: ReturnType<typeof getQueryBaseline>;
  try {
    baseline = getQueryBaseline(db, opts.baselineName);
  } finally {
    closeDb(db, { readonly: true });
  }

  if (baseline === undefined) {
    emitErrorMaybeJson(
      `codemap: no baseline named "${opts.baselineName}". Use --baselines to list saved baselines.`,
      opts.json,
    );
    return;
  }

  let baselineRows: unknown[];
  try {
    baselineRows = JSON.parse(baseline.rows_json) as unknown[];
  } catch {
    emitErrorMaybeJson(
      `codemap: baseline "${opts.baselineName}" has corrupt rows_json — drop and re-save.`,
      opts.json,
    );
    return;
  }

  let currentRows: unknown[];
  try {
    currentRows = queryRows(opts.sql);
  } catch (err) {
    emitErrorMaybeJson(
      err instanceof Error ? err.message : String(err),
      opts.json,
    );
    return;
  }
  if (opts.changedFiles !== undefined) {
    currentRows = filterRowsByChangedFiles(currentRows, opts.changedFiles);
  }

  const { added, removed } = diffRows(baselineRows, currentRows);

  // Recipe actions enrich `added` only — they're the rows the agent should act on.
  const enrichedAdded =
    opts.recipeActions !== undefined && opts.recipeActions.length > 0
      ? added.map((row) => attachActionsForGrouped(row, opts.recipeActions!))
      : added;

  const diff: BaselineDiff = {
    baseline: {
      name: baseline.name,
      recipe_id: baseline.recipe_id,
      row_count: baseline.row_count,
      git_ref: baseline.git_ref,
      created_at: baseline.created_at,
    },
    current_row_count: currentRows.length,
    added: enrichedAdded,
    removed,
  };

  if (opts.summary) {
    const payload = {
      baseline: diff.baseline,
      current_row_count: diff.current_row_count,
      added: added.length,
      removed: removed.length,
    };
    if (opts.json) {
      console.log(JSON.stringify(payload));
    } else {
      console.log(
        `baseline "${diff.baseline.name}": ${diff.baseline.row_count} rows → ${diff.current_row_count} rows  (+${added.length} / -${removed.length})`,
      );
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(diff));
    return;
  }

  console.log(
    `baseline "${diff.baseline.name}": ${diff.baseline.row_count} rows → ${diff.current_row_count} rows  (+${added.length} / -${removed.length})`,
  );
  if (added.length > 0) {
    console.log(`\n  added (+${added.length}):`);
    console.table(enrichedAdded);
  }
  if (removed.length > 0) {
    console.log(`\n  removed (-${removed.length}):`);
    console.table(removed);
  }
  if (added.length === 0 && removed.length === 0) {
    console.log("  no diff.");
  }
}
