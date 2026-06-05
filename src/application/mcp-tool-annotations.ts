/**
 * MCP ToolAnnotations hints for `tools/list` and HTTP `GET /tools`.
 * Advisory only — handlers unchanged; see docs/plans/mcp-tool-annotations.md.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { McpToolName } from "./mcp-tool-allowlist";

export interface CodemapToolAnnotationHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

export const MCP_TOOL_ANNOTATIONS: Record<
  McpToolName,
  CodemapToolAnnotationHints
> = {
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
};

export function getMcpToolAnnotations(
  name: McpToolName,
): ToolAnnotations | undefined {
  const hints = MCP_TOOL_ANNOTATIONS[name];
  if (hints === undefined) return undefined;
  return {
    readOnlyHint: hints.readOnlyHint,
    destructiveHint: hints.destructiveHint,
    idempotentHint: hints.idempotentHint,
  };
}

/** HTTP `GET /tools` catalog entry — same hint fields as MCP `tools/list`. */
export function buildHttpToolCatalogEntry(name: McpToolName): {
  name: McpToolName;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
} {
  const hints = MCP_TOOL_ANNOTATIONS[name];
  return { name, ...hints };
}
