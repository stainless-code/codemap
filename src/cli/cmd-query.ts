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
  | { kind: "run"; sql: string; json: boolean }
  | { kind: "recipesCatalog" }
  | { kind: "printRecipeSql"; id: string } {
  if (rest[0] !== "query") {
    throw new Error("parseQueryRest: expected query");
  }
  if (rest.length === 1) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] "<SQL>" | codemap query [--json] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id>\nRun codemap query --help for more.',
    };
  }

  let i = 1;
  let json = false;
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
    if (a === "--recipe") {
      const name = rest[i + 1];
      if (name === undefined || name.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap: "--recipe" requires a recipe id. Example: codemap query --recipe fan-out',
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
    return { kind: "run", sql, json };
  }

  const sql = rest.slice(i).join(" ").trim();
  if (!sql) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] "<SQL>" | codemap query [--json] --recipe <id> | codemap query --recipes-json | codemap query --print-sql <id>',
    };
  }
  return { kind: "run", sql, json };
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
  const lines = ids.map((id) => {
    const meta = QUERY_RECIPES[id];
    const desc = meta?.description ?? "";
    return `    ${id.padEnd(16)} ${desc}`;
  });
  return lines.join("\n");
}

/**
 * Print **`codemap query`** usage, flags, and bundled recipe ids to stdout.
 */
export function printQueryCmdHelp(): void {
  const recipeBlock = formatRecipeHelpLines();
  console.log(`Usage: codemap query [--json] "<SQL>"
       codemap query [--json] --recipe <id>
       codemap query --recipes-json
       codemap query --print-sql <id>

Read-only SQL against .codemap.db (after at least one successful index run).
The CLI does not cap row count — use SQL LIMIT (and ORDER BY) when you need a bounded result set.

  --json          Print a JSON array of row objects to stdout (for agents and scripts).
                  On error, prints a single object: {"error":"<message>"} to stdout.

  --recipe <id>   Run bundled SQL (no SQL string on the command line).

  --recipes-json  Print all bundled recipes (id, description, sql) as JSON to stdout. No DB.

  --print-sql <id> Print one recipe's SQL text to stdout (does not run the query). No DB.

Bundled recipes:
${recipeBlock}

Examples:
  codemap query "SELECT name, file_path FROM symbols LIMIT 10"
  codemap query --json "SELECT COUNT(*) AS n FROM symbols"
  codemap query --recipe fan-out
  codemap query --json --recipe fan-out-sample
  codemap query --recipes-json
  codemap query --print-sql fan-out
`);
}

/**
 * Initialize Codemap for `opts.root`, then run **`printQueryResult`** and **`process.exit(1)`** on failure.
 */
export async function runQueryCmd(opts: {
  root: string;
  configFile: string | undefined;
  sql: string;
  json?: boolean;
}): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile);
  initCodemap(resolveCodemapConfig(opts.root, user));
  configureResolver(getProjectRoot(), getTsconfigPath());
  const code = printQueryResult(opts.sql, { json: opts.json });
  if (code !== 0) process.exit(1);
}
