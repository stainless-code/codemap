import { OUTCOME_ALIASES } from "../outcome-aliases";
import type { OutcomeAlias } from "../outcome-aliases";

export { OUTCOME_ALIASES };
export type { OutcomeAlias };

export function isOutcomeAlias(token: string): token is OutcomeAlias {
  return Object.hasOwn(OUTCOME_ALIASES, token);
}

/** Returns `null` (not `undefined`) so callers `if (rewritten)` falls through cleanly to the existing dispatch. */
export function resolveOutcomeAlias(rest: string[]): string[] | null {
  const head = rest[0];
  if (!head || !isOutcomeAlias(head)) return null;
  const recipeId = OUTCOME_ALIASES[head];
  return ["query", "--recipe", recipeId, ...rest.slice(1)];
}

export function printOutcomeAliasHelp(alias: OutcomeAlias): void {
  const recipeId = OUTCOME_ALIASES[alias];
  console.log(`Usage: codemap ${alias} [query flags...]

Alias for \`codemap query --recipe ${recipeId}\` — every flag accepted by
\`codemap query\` passes through (--json, --format sarif|annotations|mermaid|diff|diff-json|codeclimate|badge,
--badge-style markdown|json, --ci, --summary, --changed-since <ref>, --group-by owner|directory|package,
--params key=value, --save-baseline[=name], --baseline[=name]).

Run \`codemap query --help\` for the full flag reference, or
\`codemap query --print-sql ${recipeId}\` to see the recipe SQL.`);
}
