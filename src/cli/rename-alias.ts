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

export type RenameAliasResult =
  | { kind: "rewrite"; argv: string[] }
  | { kind: "error"; message: string };

function renameError(message: string): RenameAliasResult {
  return { kind: "error", message };
}

/** Split passthrough tail into bare positionals vs apply flags (value-taking flags kept paired). */
function splitPassthrough(tokens: string[]): {
  positionals: string[];
  applyTail: string[];
} {
  const positionals: string[] = [];
  const applyTail: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const a = tokens[i]!;
    if (a === "--max-passes" || a === "--commit") {
      const next = tokens[i + 1];
      if (next === undefined) {
        applyTail.push(a);
        i++;
        continue;
      }
      applyTail.push(a, next);
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      applyTail.push(a);
      i++;
      continue;
    }
    positionals.push(a);
    i++;
  }
  return { positionals, applyTail };
}

function readFlagOperand(
  flag: string,
  token: string,
  tail: string[],
  index: number,
): { value: string | undefined; nextIndex: number } | null {
  if (token === flag) {
    return { value: tail[index + 1], nextIndex: index + 2 };
  }
  const prefix = `${flag}=`;
  if (token.startsWith(prefix)) {
    const value = token.slice(prefix.length);
    return { value: value === "" ? undefined : value, nextIndex: index + 1 };
  }
  return null;
}

function buildApplyArgv(
  params: RecipeParamValues | undefined,
  applyTail: string[],
): string[] {
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

/**
 * Thin alias: `codemap rename` → `codemap apply rename-preview`.
 * Moat A — no new write verb semantics; same recipe + policy gates as `apply`.
 */
export function resolveRenameAlias(rest: string[]): RenameAliasResult | null {
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
        return {
          kind: "rewrite",
          argv: ["apply", RENAME_RECIPE_ID, "--params"],
        };
      }
      params = mergeParams(params, parseParamsCli(next));
      i += 2;
      continue;
    }
    const defineIn = readFlagOperand("--define-in", a, tail, i);
    if (defineIn !== null) {
      if (defineIn.value === undefined) {
        return renameError(
          'codemap rename: "--define-in" requires a file path.',
        );
      }
      params = mergeParams(params, { define_in: defineIn.value });
      i = defineIn.nextIndex;
      continue;
    }
    const inFile = readFlagOperand("--in-file", a, tail, i);
    if (inFile !== null) {
      if (inFile.value === undefined) {
        return renameError(
          'codemap rename: "--in-file" requires a path prefix.',
        );
      }
      params = mergeParams(params, { in_file: inFile.value });
      i = inFile.nextIndex;
      continue;
    }
    const kind = readFlagOperand("--kind", a, tail, i);
    if (kind !== null) {
      if (kind.value === undefined) {
        return renameError('codemap rename: "--kind" requires a symbol kind.');
      }
      params = mergeParams(params, { kind: kind.value });
      i = kind.nextIndex;
      continue;
    }
    passthrough.push(a);
    i++;
  }

  const { positionals, applyTail } = splitPassthrough(passthrough);

  if (positionals.length === 1) {
    return renameError(
      "codemap rename: requires <old> and <new> (or pass old=/new= via --params).",
    );
  }
  if (positionals.length > 2) {
    return renameError(
      `codemap rename: unexpected argument "${positionals[2]}".`,
    );
  }

  if (positionals.length === 2) {
    params = mergeParams(params, {
      old: positionals[0]!,
      new: positionals[1]!,
    });
  }

  const hasOldNew =
    params !== undefined &&
    params.old !== undefined &&
    params.new !== undefined;

  if (!hasOldNew) {
    return renameError(
      "codemap rename: requires <old> and <new> (or pass old=/new= via --params).",
    );
  }

  return { kind: "rewrite", argv: buildApplyArgv(params, applyTail) };
}

export function printRenameAliasHelp(): void {
  console.log(`Usage:
  codemap rename <old> <new> [--define-in <file_path>] [--in-file <prefix>] [--kind <k>] [apply flags...]
  codemap rename --params old=<old>,new=<new>[,define_in=<file_path>] [apply flags...]

Alias for \`codemap apply rename-preview\` — homonym-safe renames pass \`--define-in\`
to anchor the file where the symbol is defined. \`--in-file\` only narrows output row paths.

Apply flags pass through: --dry-run, --yes, --force, --json, --until-empty,
--max-passes N, --commit "<msg>".

Examples:
  codemap rename usePermissions useAccess --kind function --dry-run
  codemap rename helper worker --define-in src/bench/homonym-helper-a.ts --yes
  codemap rename --params old=foo,new=bar,define_in=src/a.ts --dry-run

Run \`codemap apply --help\` for executor details.`);
}
