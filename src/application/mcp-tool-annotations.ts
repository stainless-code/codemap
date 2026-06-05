/**
 * MCP ToolAnnotations hints for `tools/list` and HTTP `GET /tools`.
 * Advisory only — handlers unchanged; see architecture.md § MCP wiring.
 */

import { ToolAnnotationsSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { McpToolName } from "./mcp-tool-allowlist";

/** M.6 — skip MCP annotations when an older SDK lacks ToolAnnotations on registerTool. */
export function sdkSupportsMcpToolAnnotations(): boolean {
  const shape = ToolAnnotationsSchema?.shape;
  return (
    typeof shape === "object" &&
    shape !== null &&
    "readOnlyHint" in shape &&
    "destructiveHint" in shape
  );
}

export const MCP_TOOL_ANNOTATIONS = {
  query: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  query_batch: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  query_recipe: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  context: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  validate: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  show: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  snippet: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  impact: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  affected: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  trace: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  explore: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  node: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  audit: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  list_baselines: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  save_baseline: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  drop_baseline: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  ingest_coverage: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  apply: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  apply_rows: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  apply_diff_input: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
} satisfies Record<McpToolName, ToolAnnotations>;

export function getMcpToolAnnotations(
  name: McpToolName,
): ToolAnnotations | undefined {
  if (!sdkSupportsMcpToolAnnotations()) return undefined;
  return MCP_TOOL_ANNOTATIONS[name];
}

/** HTTP `GET /tools` catalog entry — same hint fields as MCP `tools/list`. */
export function buildHttpToolCatalogEntry(name: McpToolName): {
  name: McpToolName;
} & ToolAnnotations {
  return { name, ...MCP_TOOL_ANNOTATIONS[name] };
}

export interface ToolRegisterConfig {
  description: string;
  inputSchema: unknown;
}

export function withToolAnnotations<T extends ToolRegisterConfig>(
  name: McpToolName,
  config: T,
): T & { annotations?: ToolAnnotations } {
  const annotations = getMcpToolAnnotations(name);
  if (annotations === undefined) return config;
  return { ...config, annotations };
}
