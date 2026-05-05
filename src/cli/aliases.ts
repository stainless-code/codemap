/**
 * Outcome-shaped CLI aliases — thin wrappers over `query --recipe <id>`.
 * Capped at 5 to avoid alias-sprawl; promote a sixth only when the recipe
 * becomes a headline outcome ([roadmap.md](../../docs/roadmap.md)).
 */
export const OUTCOME_ALIASES = Object.freeze({
  "dead-code": "untested-and-dead",
  deprecated: "deprecated-symbols",
  boundaries: "boundary-violations",
  hotspots: "fan-in",
  "coverage-gaps": "worst-covered-exports",
} as const);

export type OutcomeAlias = keyof typeof OUTCOME_ALIASES;

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
\`codemap query\` passes through (--json, --format sarif|annotations|mermaid|diff|diff-json,
--ci, --summary, --changed-since <ref>, --group-by owner|directory|package,
--params key=value, --save-baseline[=name], --baseline[=name]).

Run \`codemap query --help\` for the full flag reference, or
\`codemap query --print-sql ${recipeId}\` to see the recipe SQL.`);
}
