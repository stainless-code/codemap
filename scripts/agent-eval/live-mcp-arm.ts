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
  const t0 = performance.now();
  try {
    const tool = requiredMcpToolForGolden(golden);
    assertLiveEvalToolEnabled(tool);
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
      ...(!result.ok
        ? { error: result.error }
        : rows === 0
          ? { error: "query returned 0 rows" }
          : {}),
    };
  } catch (err) {
    return {
      wallMs: performance.now() - t0,
      toolSequence: [],
      toolCallCount: 0,
      resultCount: 0,
      estTokens: estimateProbeTokens(prompt, 0),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
