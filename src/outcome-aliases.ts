/**
 * Outcome-shaped CLI aliases — thin wrappers over `query --recipe <id>`.
 * Shared by `src/cli/aliases.ts` and `context-engine` cli_entry_hints (keep in sync).
 */
export const OUTCOME_ALIASES = Object.freeze({
  "dead-code": "untested-and-dead",
  deprecated: "deprecated-symbols",
  boundaries: "boundary-violations",
  hotspots: "fan-in",
  "coverage-gaps": "worst-covered-exports",
} as const);

export type OutcomeAlias = keyof typeof OUTCOME_ALIASES;
