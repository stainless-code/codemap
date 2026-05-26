/**
 * Capture entries-transcript session logs from real MCP handlers + traditional
 * file-scan arms (dev-only). Writes logs for compare-live-logs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../../src/api";
import {
  handleQuery,
  handleQueryRecipe,
} from "../../src/application/tool-handlers";
import type { QueryRecipeArgs } from "../../src/application/tool-handlers";
import { resolveCodemapConfig } from "../../src/config";
import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import { parseScenariosJson } from "../query-golden/schema";
import type { GoldenScenario } from "../query-golden/schema";
import {
  ensureLiveEvalMcpToolsEnv,
  requiredMcpToolForGolden,
} from "./mcp-allowlist";
import { parseProbesJson } from "./schema";
import type { AgentEvalProbe, TraditionalSpec } from "./schema";
import { resultCountFromToolPayload } from "./tool-payload";
import {
  runTraditionalProbe,
  traditionalToolSequence,
} from "./traditional-probe";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(EVAL_DIR, "../..");

type LogEntry = Record<string, unknown>;

function assistantAnswer(probeId: string, resultCount: number): string {
  if (resultCount <= 0) return `No results for ${probeId}.`;
  return `Completed ${probeId} (${resultCount} row(s)).`;
}

function traditionalToolArgs(
  tool: string,
  spec: TraditionalSpec,
  readIdx: number,
): Record<string, unknown> {
  if (tool === "glob" && "globs" in spec) {
    return { glob_pattern: spec.globs.join(",") };
  }
  if (tool === "grep" && "regex" in spec) {
    return { pattern: spec.regex };
  }
  if (tool === "read") {
    return { path: `file-${readIdx}.ts` };
  }
  return {};
}

function buildMcpOnSession(
  probes: AgentEvalProbe[],
  goldenById: Map<string, GoldenScenario>,
  fixtureRoot: string,
): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const probe of probes) {
    const golden = goldenById.get(probe.goldenId);
    if (golden === undefined) continue;
    const prompt = golden.prompt ?? probe.id;
    entries.push({ kind: "user", text: prompt });
    const tool = requiredMcpToolForGolden(golden);
    const t0 = performance.now();
    let callArgs: QueryRecipeArgs | { sql: string };
    let result;
    if (tool === "query_recipe") {
      callArgs = {
        recipe: golden.recipe!,
        ...(golden.params !== undefined ? { params: golden.params } : {}),
      };
      result = handleQueryRecipe(callArgs, fixtureRoot);
    } else {
      const { sql } = resolveGoldenQuery(golden);
      callArgs = { sql };
      result = handleQuery({ sql }, fixtureRoot);
    }
    const wallMs = performance.now() - t0;
    entries.push({
      kind: "tool_call",
      tool: `mcp_codemap_${tool}`,
      args: callArgs,
      wallMs,
    });
    entries.push({
      kind: "tool_result",
      tool: `mcp_codemap_${tool}`,
      result: result.ok ? result.payload : result.error,
    });
    const rows =
      result.ok && result.format === "json"
        ? resultCountFromToolPayload(result.payload)
        : 0;
    entries.push({
      kind: "assistant",
      text: assistantAnswer(probe.id, rows),
    });
  }
  return entries;
}

function buildMcpOffSession(
  probes: AgentEvalProbe[],
  goldenById: Map<string, GoldenScenario>,
): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const probe of probes) {
    const golden = goldenById.get(probe.goldenId);
    const prompt = golden?.prompt ?? probe.id;
    entries.push({ kind: "user", text: prompt });
    const trad = runTraditionalProbe(probe.traditional);
    const sequence = traditionalToolSequence(trad.filesRead);
    const perToolMs = trad.wallMs / Math.max(sequence.length, 1);
    let readIdx = 0;
    for (const tool of sequence) {
      if (tool === "read") readIdx++;
      entries.push({
        kind: "tool_call",
        tool: tool === "glob" ? "Glob" : tool === "grep" ? "Grep" : "Read",
        args: traditionalToolArgs(tool, probe.traditional, readIdx),
        wallMs: perToolMs,
      });
    }
    entries.push({
      kind: "assistant",
      text: assistantAnswer(probe.id, trad.results.length),
    });
  }
  return entries;
}

async function main(): Promise<void> {
  const fixtureRoot = resolve(
    process.env.AGENT_EVAL_FIXTURE_ROOT ?? join(REPO_ROOT, "fixtures/minimal"),
  );
  const outDir = resolve(
    process.env.AGENT_EVAL_SESSION_DIR ??
      join(REPO_ROOT, ".agent-eval/sessions"),
  );
  const scenariosPath = resolve(
    process.env.AGENT_EVAL_SCENARIOS ??
      join(REPO_ROOT, "fixtures/golden/scenarios.json"),
  );
  const probesPath = join(EVAL_DIR, "scenarios.json");

  const { probes } = parseProbesJson(readFileSync(probesPath, "utf-8"));
  const { scenarios: goldenScenarios } = parseScenariosJson(
    readFileSync(scenariosPath, "utf-8"),
  );
  const goldenById = new Map(goldenScenarios.map((s) => [s.id, s]));

  const priorRoot = process.env.CODEMAP_ROOT;
  const priorMcpTools = process.env.CODEMAP_MCP_TOOLS;
  process.env.CODEMAP_ROOT = fixtureRoot;
  ensureLiveEvalMcpToolsEnv(process.env);

  try {
    const cm = await createCodemap({ root: fixtureRoot });
    await cm.index({ mode: "full", quiet: true });
    console.log(
      `Indexed ${fixtureRoot} → ${resolveCodemapConfig(fixtureRoot, undefined).databasePath}`,
    );

    const mcpOnEntries = buildMcpOnSession(probes, goldenById, fixtureRoot);
    const mcpOffEntries = buildMcpOffSession(probes, goldenById);

    mkdirSync(outDir, { recursive: true });
    const mcpOnPath = join(outDir, "real-mcp-on.json");
    const mcpOffPath = join(outDir, "real-mcp-off.json");
    writeFileSync(
      mcpOnPath,
      `${JSON.stringify({ entries: mcpOnEntries }, null, 2)}\n`,
    );
    writeFileSync(
      mcpOffPath,
      `${JSON.stringify({ entries: mcpOffEntries }, null, 2)}\n`,
    );
    console.log(`Wrote ${mcpOnPath}`);
    console.log(`Wrote ${mcpOffPath}`);
  } finally {
    if (priorRoot === undefined) delete process.env.CODEMAP_ROOT;
    else process.env.CODEMAP_ROOT = priorRoot;
    if (priorMcpTools === undefined) delete process.env.CODEMAP_MCP_TOOLS;
    else process.env.CODEMAP_MCP_TOOLS = priorMcpTools;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
