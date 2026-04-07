import { printQueryResult } from "../application/index-engine";
import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import {
  getQueryRecipeSql,
  listQueryRecipeIds,
  QUERY_RECIPES,
} from "./query-recipes";

/**
 * Parse argv after global bootstrap: `rest[0]` must be `"query"`.
 * Supports `--json`, `--recipe <id>`, and raw SQL (see `printQueryCmdHelp`).
 */
export function parseQueryRest(
  rest: string[],
):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "run"; sql: string; json: boolean } {
  if (rest[0] !== "query") {
    throw new Error("parseQueryRest: expected query");
  }
  if (rest.length === 1) {
    return {
      kind: "error",
      message:
        'codemap: missing SQL or recipe. Usage: codemap query [--json] "<SQL>" | codemap query [--json] --recipe <id>\nRun codemap query --help for more.',
    };
  }

  let i = 1;
  let json = false;
  let recipeId: string | undefined;

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
        'codemap: missing SQL or recipe. Usage: codemap query [--json] "<SQL>" | codemap query [--json] --recipe <id>',
    };
  }
  return { kind: "run", sql, json };
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

export function printQueryCmdHelp(): void {
  const recipeBlock = formatRecipeHelpLines();
  console.log(`Usage: codemap query [--json] "<SQL>"
       codemap query [--json] --recipe <id>

Read-only SQL against .codemap.db (after at least one successful index run).
The CLI does not cap row count — use SQL LIMIT (and ORDER BY) when you need a bounded result set.

  --json          Print a JSON array of row objects to stdout (for agents and scripts).
                  On error, prints a single object: {"error":"<message>"} to stdout.

  --recipe <id>   Run bundled SQL (no SQL string on the command line).

Bundled recipes:
${recipeBlock}

Examples:
  codemap query "SELECT name, file_path FROM symbols LIMIT 10"
  codemap query --json "SELECT COUNT(*) AS n FROM symbols"
  codemap query --recipe fan-out
  codemap query --json --recipe fan-out-sample
`);
}

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
