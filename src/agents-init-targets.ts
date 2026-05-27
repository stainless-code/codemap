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

/** Same order as interactive multiselect in `agents-init-interactive.ts`. */
export const AGENTS_INIT_TARGET_IDS: readonly AgentsInitTarget[] = [
  "cursor",
  "claude-md",
  "copilot",
  "windsurf",
  "continue",
  "cline",
  "amazon-q",
  "agents-md",
  "gemini-md",
] as const;

const AGENTS_INIT_TARGET_ID_SET = new Set<string>(AGENTS_INIT_TARGET_IDS);

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

export function isAgentsInitTarget(id: string): id is AgentsInitTarget {
  return AGENTS_INIT_TARGET_ID_SET.has(id);
}

export function formatAgentsInitTargetIdsForError(): string {
  return AGENTS_INIT_TARGET_IDS.join(", ");
}

/**
 * Parse `--targets` argv segments (`cursor,copilot` or repeated flags).
 * Dedupes while preserving first-seen order.
 */
export function parseAgentsInitTargets(raw: string[]): AgentsInitTarget[] {
  const out: AgentsInitTarget[] = [];
  const seen = new Set<AgentsInitTarget>();
  for (const segment of raw) {
    for (const part of segment.split(",")) {
      const id = part.trim();
      if (id.length === 0) {
        throw new Error(
          "codemap: --targets requires at least one integration id",
        );
      }
      if (!isAgentsInitTarget(id)) {
        throw new Error(
          `codemap: unknown integration ${JSON.stringify(id)}. Valid ids: ${formatAgentsInitTargetIdsForError()}`,
        );
      }
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  if (out.length === 0) {
    throw new Error("codemap: --targets requires at least one integration id");
  }
  return out;
}
