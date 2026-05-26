import {
  isMcpToolEnabled,
  resolveMcpToolAllowlist,
} from "../../src/application/mcp-tool-allowlist";
import type { McpToolName } from "../../src/application/mcp-tool-allowlist";
import type { GoldenScenario } from "../query-golden/schema";

/** Minimal MCP tools for live eval arms (benchmark § Agent eval harness). */
export const LIVE_EVAL_MCP_TOOLS = ["query", "query_recipe"] as const;

export type LiveEvalMcpTool = (typeof LIVE_EVAL_MCP_TOOLS)[number];

export function defaultLiveEvalMcpToolsEnv(): string {
  return LIVE_EVAL_MCP_TOOLS.join(",");
}

export function requiredMcpToolForGolden(
  golden: GoldenScenario,
): LiveEvalMcpTool {
  return golden.recipe !== undefined ? "query_recipe" : "query";
}

export function assertLiveEvalToolEnabled(
  tool: McpToolName,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { allowlist } = resolveMcpToolAllowlist(env);
  if (!isMcpToolEnabled(tool, allowlist)) {
    const active =
      allowlist === null
        ? "all tools"
        : [...allowlist].join(", ") || "(empty allowlist)";
    throw new Error(
      `agent-eval live: MCP tool "${tool}" is not enabled (CODEMAP_MCP_TOOLS=${active})`,
    );
  }
}

export function resolveLiveEvalMcpTools(
  env: NodeJS.ProcessEnv = process.env,
): readonly LiveEvalMcpTool[] {
  const { allowlist } = resolveMcpToolAllowlist(env);
  if (allowlist === null) return LIVE_EVAL_MCP_TOOLS;
  return LIVE_EVAL_MCP_TOOLS.filter((tool) => allowlist.has(tool));
}
