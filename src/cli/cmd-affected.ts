import { stdin as input } from "node:process";

import { executeQuery } from "../application/query-engine";
import {
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "../application/query-recipes";
import { resolveRecipeParams } from "../application/recipe-params";
import { getFilesChangedSince } from "../git-changed";
import { getProjectRoot } from "../runtime";
import { bootstrapCodemap } from "./bootstrap-codemap";

/** Delimiter for `affected-tests.changed_files` (ASCII RS). */
export const CHANGED_PATH_DELIM = "\u001e";

export interface AffectedOpts {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  changedPaths: string[];
  testGlob: string | undefined;
  maxDepth: number | undefined;
  json: boolean;
}

/**
 * Join project-relative paths for the `affected-tests` recipe param.
 * Filters empty segments; preserves order of first occurrence.
 */
export function joinChangedPaths(paths: Iterable<string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const path = raw.trim().replace(/^\.\/+/, "");
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out.join(CHANGED_PATH_DELIM);
}

/**
 * Read newline-delimited paths from stdin (ignores empty lines).
 */
export async function readChangedPathsFromStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\/+/, ""))
    .filter((line) => line.length > 0);
}

export function printAffectedCmdHelp(): void {
  console.log(`Usage: codemap affected [--stdin] [--changed-since <ref>] [--params k=v] [--json] [<path>...]

List test files transitively impacted by changed source files (reverse BFS on
\`dependencies\`). Output is file paths only — CI composes the runner command.

Path sources (first match wins):
  1. Positional <path>... arguments
  2. --stdin            newline-delimited paths from a pipe
  3. --changed-since    git diff + working tree vs <ref>
  4. (default)          same as --changed-since HEAD

Flags:
  --params key=value    Pass recipe params (repeatable). Supported: test_glob,
                        max_depth. changed_files is built automatically.
  --json                Emit JSON array of {test_path, impact_depth}.
  --help, -h            Show this help.

Examples:
  codemap affected --json
  git diff --name-only origin/main | codemap affected --stdin --json
  codemap affected src/lib/cache.ts --json
  codemap affected --params test_glob='src/**/__tests__/*' --json
`);
}

export function parseAffectedRest(rest: string[]):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | {
      kind: "run";
      stdin: boolean;
      changedSince: string | undefined;
      positionalPaths: string[];
      testGlob: string | undefined;
      maxDepth: number | undefined;
      json: boolean;
    } {
  if (rest[0] !== "affected") {
    throw new Error("parseAffectedRest: expected affected");
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    return { kind: "help" };
  }

  let stdin = false;
  let changedSince: string | undefined;
  let testGlob: string | undefined;
  let maxDepth: number | undefined;
  let json = false;
  const positionalPaths: string[] = [];

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--stdin") {
      stdin = true;
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--changed-since") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message:
            'codemap affected: "--changed-since" requires a git ref (e.g. origin/main).',
        };
      }
      changedSince = next;
      i++;
      continue;
    }
    if (a === "--params") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) {
        return {
          kind: "error",
          message: 'codemap affected: "--params" requires key=value.',
        };
      }
      for (const part of next.split(",")) {
        const eq = part.indexOf("=");
        const key = eq === -1 ? part : part.slice(0, eq);
        const value = eq === -1 ? "" : part.slice(eq + 1);
        if (key === "test_glob") testGlob = value;
        else if (key === "max_depth") {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            return {
              kind: "error",
              message: `codemap affected: --params max_depth="${value}" must be a non-negative number.`,
            };
          }
          maxDepth = n;
        } else if (key === "changed_files") {
          return {
            kind: "error",
            message:
              "codemap affected: changed_files is built from stdin/git/positional paths — omit from --params.",
          };
        } else if (key.length > 0) {
          return {
            kind: "error",
            message: `codemap affected: unknown --params key "${key}" (supported: test_glob, max_depth).`,
          };
        }
      }
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      return {
        kind: "error",
        message: `codemap affected: unknown option "${a}". Run \`codemap affected --help\` for usage.`,
      };
    }
    positionalPaths.push(a.trim().replace(/^\.\/+/, ""));
  }

  if (stdin && positionalPaths.length > 0) {
    return {
      kind: "error",
      message: "codemap affected: pass positional paths OR --stdin, not both.",
    };
  }

  return {
    kind: "run",
    stdin,
    changedSince,
    positionalPaths,
    testGlob,
    maxDepth,
    json,
  };
}

async function resolveChangedPaths(opts: {
  root: string;
  stdin: boolean;
  changedSince: string | undefined;
  positionalPaths: string[];
}): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  if (opts.positionalPaths.length > 0) {
    return { ok: true, paths: opts.positionalPaths };
  }
  if (opts.stdin) {
    return { ok: true, paths: await readChangedPathsFromStdin() };
  }
  const ref = opts.changedSince ?? "HEAD";
  const result = getFilesChangedSince(ref, opts.root);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, paths: [...result.files] };
}

/**
 * Run `codemap affected`. Bootstraps, executes the `affected-tests` recipe.
 */
export async function runAffectedCmd(opts: AffectedOpts): Promise<void> {
  try {
    await bootstrapCodemap(opts);

    const changedRaw = joinChangedPaths(opts.changedPaths);
    if (changedRaw.length === 0) {
      if (opts.json) {
        console.log("[]");
      } else {
        console.log("(no changed files — no affected tests)");
      }
      return;
    }

    const declared = getQueryRecipeParams("affected-tests");
    const resolved = resolveRecipeParams({
      recipeId: "affected-tests",
      declared,
      provided: {
        changed_files: changedRaw,
        ...(opts.testGlob !== undefined ? { test_glob: opts.testGlob } : {}),
        ...(opts.maxDepth !== undefined ? { max_depth: opts.maxDepth } : {}),
      },
    });
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }

    const sql = getQueryRecipeSql("affected-tests");
    if (sql === undefined) {
      throw new Error(
        'codemap affected: bundled recipe "affected-tests" missing',
      );
    }

    const payload = executeQuery({
      sql,
      bindValues: resolved.values,
      root: getProjectRoot(),
      recipeActions: undefined,
    });

    if (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "error" in payload
    ) {
      throw new Error(String((payload as { error: string }).error));
    }

    const rows = payload as unknown[];

    if (opts.json) {
      console.log(JSON.stringify(rows));
      return;
    }

    if (rows.length === 0) {
      console.log("(no affected test files)");
      return;
    }

    for (const row of rows) {
      if (typeof row === "object" && row !== null && "test_path" in row) {
        const r = row as { test_path: string; impact_depth?: number };
        const depth =
          r.impact_depth === undefined ? "" : `\t(depth ${r.impact_depth})`;
        console.log(`${r.test_path}${depth}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

export async function runAffectedFromParsed(opts: {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  parsed: Extract<ReturnType<typeof parseAffectedRest>, { kind: "run" }>;
}): Promise<void> {
  const pathsResult = await resolveChangedPaths({
    root: opts.root,
    stdin: opts.parsed.stdin,
    changedSince: opts.parsed.changedSince,
    positionalPaths: opts.parsed.positionalPaths,
  });
  if (!pathsResult.ok) {
    if (opts.parsed.json) {
      console.log(JSON.stringify({ error: pathsResult.error }));
    } else {
      console.error(pathsResult.error);
    }
    process.exitCode = 1;
    return;
  }

  await runAffectedCmd({
    root: opts.root,
    configFile: opts.configFile,
    stateDir: opts.stateDir,
    changedPaths: pathsResult.paths,
    testGlob: opts.parsed.testGlob,
    maxDepth: opts.parsed.maxDepth,
    json: opts.parsed.json,
  });
}
