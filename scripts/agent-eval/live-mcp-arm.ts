import {
  handleQuery,
  handleQueryRecipe,
} from "../../src/application/tool-handlers";
import type {
  QueryRecipeArgs,
  ToolResult,
} from "../../src/application/tool-handlers";
import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import type { GoldenScenario } from "../query-golden/schema";
import {
  assertLiveEvalToolEnabled,
  requiredMcpToolForGolden,
} from "./mcp-allowlist";
import { estimateProbeTokens } from "./probe-tokens";
import type { ArmRunMetrics } from "./run-probes";
import {
  liveMcpPayloadChars,
  resultCountFromToolPayload,
} from "./tool-payload";

export function runLiveMcpArm(
  golden: GoldenScenario,
  root: string,
  prompt: string,
): ArmRunMetrics {
  const tool = requiredMcpToolForGolden(golden);
  assertLiveEvalToolEnabled(tool);
  const t0 = performance.now();
  let callArgs: QueryRecipeArgs | { sql: string };
  let result: ToolResult;
  if (tool === "query_recipe") {
    if (golden.recipe === undefined) {
      throw new Error(
        `agent-eval live: golden "${golden.id}" requires recipe for query_recipe arm`,
      );
    }
    callArgs = {
      recipe: golden.recipe,
      ...(golden.params !== undefined ? { params: golden.params } : {}),
    };
    result = handleQueryRecipe(callArgs, root);
  } else {
    const { sql } = resolveGoldenQuery(golden);
    callArgs = { sql };
    result = handleQuery({ sql }, root);
  }
  const wallMs = performance.now() - t0;
  const toolSequence = [tool];
  const rows =
    result.ok && result.format === "json"
      ? resultCountFromToolPayload(result.payload)
      : 0;
  return {
    wallMs,
    toolSequence,
    toolCallCount: toolSequence.length,
    resultCount: rows,
    estTokens: estimateProbeTokens(
      prompt,
      liveMcpPayloadChars(tool, callArgs, result),
    ),
    success: result.ok && rows > 0,
  };
}
