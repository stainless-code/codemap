import { printQueryResult } from "../application/index-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import {
  getQueryRecipeSql,
  listQueryRecipeCatalog,
  listQueryRecipeIds,
  QUERY_RECIPES,
} from "./query-recipes";

/**
 * Parse `argv` after the global bootstrap: `rest[0]` must be `"query"`.
 * Supports `--json`, `--recipe <id>`, `--recipes-json`, `--print-sql <id>`, and raw SQL (see {@link printQueryCmdHelp}).
 */
export function parseQueryRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; sql: string; json: boolean; summary: boolean }
  | { kind: "recipesCatalog" }
  | { kind: "printRecipeSql"; id: string } {
  if (rest[0] !== "query") {
    throw new Error("parseQueryRest: expected query");
  }
  if (rest.length === 1) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] [--summary] "<SQL>" | codemap query [--json] [--summary] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id>\nRun codemap query --help for more.',
    };
  }

  let i = 1;
  let json = false;
  let summary = false;
  let recipeId: string | undefined;
  let recipesJson = false;
  let printSqlId: string | undefined;

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
    return { kind: "run", sql, json, summary };
  }

  const sql = rest.slice(i).join(" ").trim();
  if (!sql) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] [--summary] "<SQL>" | codemap query [--json] [--summary] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id>',
    };
  }
  return { kind: "run", sql, json, summary };
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
  console.log(`Usage: codemap query [--json] [--summary] "<SQL>"
       codemap query [--json] [--summary] --recipe <id>     (alias: -r)
       codemap query --recipes-json
       codemap query --print-sql <id>

Read-only SQL against .codemap.db (after at least one successful index run).
The CLI does not cap row count — use SQL LIMIT (and ORDER BY) when you need a bounded result set.

Flags:
  --json              Print a JSON array of row objects to stdout (for agents and scripts).
                      On error, prints a single object: {"error":"<message>"} to stdout.
  --summary           Print only the row count (no rows). With --json: {"count": N}. Without: count: N.
                      Useful for dashboards and agent context windows where the rows are noise.
  --recipe, -r <id>   Run bundled SQL (no SQL string on the command line).
  --recipes-json      Print all bundled recipes (id, description, sql) as JSON to stdout. No DB.
  --print-sql <id>    Print one recipe's SQL text to stdout (does not run the query). No DB.
  --help, -h          Show this help.

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
}): Promise<void> {
  try {
    const user = await loadUserConfig(opts.root, opts.configFile);
    initCodemap(resolveCodemapConfig(opts.root, user));
    configureResolver(getProjectRoot(), getTsconfigPath());
    const code = printQueryResult(opts.sql, {
      json: opts.json,
      summary: opts.summary,
    });
    if (code !== 0) process.exitCode = code;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: msg }));
    } else {
      console.error(msg);
    }
    process.exitCode = 1;
  }
}
