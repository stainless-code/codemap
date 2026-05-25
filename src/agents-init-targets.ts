/**
 * IDE integration targets for `codemap agents init` — shared by init + MCP registry
 * without importing the full init module.
 */
export type AgentsInitTarget =
  | "cursor"
  | "claude-md"
  | "copilot"
  | "windsurf"
  | "continue"
  | "cline"
  | "amazon-q"
  | "agents-md"
  | "gemini-md";

/** Targets that mirror `.agents/rules` (and Cursor also `.agents/skills`) via per-file symlink or copy. */
export const AGENTS_INIT_SYMLINK_TARGETS: readonly AgentsInitTarget[] = [
  "cursor",
  "windsurf",
  "continue",
  "cline",
  "amazon-q",
] as const;

export function targetsNeedLinkMode(targets: AgentsInitTarget[]): boolean {
  return targets.some((t) => AGENTS_INIT_SYMLINK_TARGETS.includes(t));
}
