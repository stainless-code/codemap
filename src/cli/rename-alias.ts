import { mergeParams, parseParamsCli } from "../application/recipe-params.js";
import type { RecipeParamValues } from "../application/recipe-params.js";

const RENAME_RECIPE_ID = "rename-preview";

/** Serialize a param map for `codemap apply --params` (stable key order). */
export function formatParamsCli(params: RecipeParamValues): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join(",");
}

/**
 * Thin alias: `codemap rename` → `codemap apply rename-preview`.
 * Moat A — no new write verb semantics; same recipe + policy gates as `apply`.
 */
export function resolveRenameAlias(rest: string[]): string[] | null {
  if (rest[0] !== "rename") return null;

  const tail = rest.slice(1);
  if (tail.includes("--help") || tail.includes("-h")) {
    return null;
  }

  let params: RecipeParamValues | undefined;
  const passthrough: string[] = [];
  let i = 0;

  while (i < tail.length) {
    const a = tail[i]!;
    if (a === "--params") {
      const next = tail[i + 1];
      if (next === undefined) {
        return ["apply", RENAME_RECIPE_ID, "--params"];
      }
      params = mergeParams(params, parseParamsCli(next));
      i += 2;
      continue;
    }
    if (a === "--define-in") {
      const next = tail[i + 1];
      if (next === undefined) {
        return ["apply", RENAME_RECIPE_ID, "--define-in"];
      }
      params = mergeParams(params, { define_in: next });
      i += 2;
      continue;
    }
    if (a === "--in-file") {
      const next = tail[i + 1];
      if (next === undefined) {
        return ["apply", RENAME_RECIPE_ID, "--in-file"];
      }
      params = mergeParams(params, { in_file: next });
      i += 2;
      continue;
    }
    if (a === "--kind") {
      const next = tail[i + 1];
      if (next === undefined) {
        return ["apply", RENAME_RECIPE_ID, "--kind"];
      }
      params = mergeParams(params, { kind: next });
      i += 2;
      continue;
    }
    passthrough.push(a);
    i++;
  }

  const head = passthrough[0];
  const second = passthrough[1];
  if (
    head !== undefined &&
    second !== undefined &&
    !head.startsWith("-") &&
    !second.startsWith("-")
  ) {
    params = mergeParams(params, { old: head, new: second });
    const applyTail = passthrough.slice(2);
    if (params && Object.keys(params).length > 0) {
      return [
        "apply",
        RENAME_RECIPE_ID,
        "--params",
        formatParamsCli(params),
        ...applyTail,
      ];
    }
    return ["apply", RENAME_RECIPE_ID, ...applyTail];
  }

  if (params && Object.keys(params).length > 0) {
    return [
      "apply",
      RENAME_RECIPE_ID,
      "--params",
      formatParamsCli(params),
      ...passthrough,
    ];
  }

  return ["apply", RENAME_RECIPE_ID, ...passthrough];
}

export function printRenameAliasHelp(): void {
  console.log(`Usage:
  codemap rename <old> <new> [--define-in <file_path>] [--in-file <prefix>] [--kind <k>] [apply flags...]
  codemap rename --params old=<old>,new=<new>[,define_in=<file_path>] [apply flags...]

Alias for \`codemap apply rename-preview\` — homonym-safe renames pass \`--define-in\`
(definition \`symbols.file_path\` anchor). \`--in-file\` only narrows output row paths.

Apply flags pass through: --dry-run, --yes, --force, --json, --until-empty,
--max-passes N, --commit "<msg>".

Examples:
  codemap rename usePermissions useAccess --kind function --dry-run
  codemap rename helper worker --define-in src/bench/homonym-helper-a.ts --yes
  codemap rename --params old=foo,new=bar,define_in=src/a.ts --dry-run

Run \`codemap apply --help\` for executor details.`);
}
