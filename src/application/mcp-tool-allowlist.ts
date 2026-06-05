/**
 * Subset registration for MCP tools via `CODEMAP_MCP_TOOLS` (comma-separated
 * snake_case names). Unset = all tools. Used by eval A/B arms and minimal installs.
 */

export const MCP_TOOL_NAMES = [
  "query",
  "query_batch",
  "query_recipe",
  "audit",
  "context",
  "validate",
  "save_baseline",
  "list_baselines",
  "drop_baseline",
  "show",
  "snippet",
  "impact",
  "affected",
  "trace",
  "explore",
  "node",
  "apply",
  "apply_rows",
  "apply_diff_input",
  "ingest_coverage",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

const KNOWN = new Set<string>(MCP_TOOL_NAMES);

export interface McpToolAllowlistResult {
  /** `null` when env unset — register every tool. */
  allowlist: Set<McpToolName> | null;
  unknown: string[];
}

export function resolveMcpToolAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): McpToolAllowlistResult {
  const raw = env.CODEMAP_MCP_TOOLS?.trim();
  if (raw === undefined || raw === "") {
    return { allowlist: null, unknown: [] };
  }
  const allowlist = new Set<McpToolName>();
  const unknown: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name === "") continue;
    if (KNOWN.has(name)) {
      allowlist.add(name as McpToolName);
    } else {
      unknown.push(name);
    }
  }
  return { allowlist, unknown };
}

export function isMcpToolEnabled(
  name: McpToolName,
  allowlist: Set<McpToolName> | null,
): boolean {
  if (allowlist === null) return true;
  return allowlist.has(name);
}

export function logMcpToolAllowlist(
  resolved: McpToolAllowlistResult,
  registered: readonly string[],
): void {
  for (const name of resolved.unknown) {
    // eslint-disable-next-line no-console -- intentional MCP bootstrap log on stderr
    console.error(
      `codemap mcp: ignoring unknown CODEMAP_MCP_TOOLS entry "${name}"`,
    );
  }
  if (resolved.allowlist !== null) {
    // eslint-disable-next-line no-console -- intentional MCP bootstrap log on stderr
    console.error(
      `codemap mcp: CODEMAP_MCP_TOOLS active — registered: ${registered.join(", ")}`,
    );
  }
}
