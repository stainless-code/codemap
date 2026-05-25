import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../../src/api";
import { queryRows } from "../../src/application/index-engine";
import {
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "../../src/application/query-recipes";
import { resolveRecipeParams } from "../../src/application/recipe-params";
import { parseScenariosJson } from "../query-golden/schema";
import type { GoldenScenario } from "../query-golden/schema";
import { estimateTokens, jsonCharLength } from "./metrics";
import { parseProbesJson } from "./schema";
import type { AgentEvalProbe } from "./schema";
import {
  runTraditionalProbe,
  traditionalToolSequence,
} from "./traditional-probe";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(EVAL_DIR, "../..");

export interface ArmRunMetrics {
  wallMs: number;
  toolSequence: string[];
  toolCallCount: number;
  resultCount: number;
  estTokens: number;
  success: boolean;
}

export interface ScenarioComparison {
  id: string;
  prompt: string;
  mcpOn: ArmRunMetrics;
  mcpOff: ArmRunMetrics;
  delta: {
    toolCallCount: number;
    wallMs: number;
    estTokens: number;
  };
}

export interface AgentEvalComparison {
  generatedAt: string;
  mode: "probe";
  fixtureRoot: string;
  runs: number;
  scenarios: ScenarioComparison[];
  summary: {
    mcpOnTotalToolCalls: number;
    mcpOffTotalToolCalls: number;
    mcpOnTotalWallMs: number;
    mcpOffTotalWallMs: number;
    mcpOnTotalEstTokens: number;
    mcpOffTotalEstTokens: number;
    successCount: number;
  };
}

function parseArgs(argv: string[]) {
  let output = join(REPO_ROOT, ".agent-eval/comparison.json");
  let runs = 1;
  let help = false;
  let fixtureRoot = join(REPO_ROOT, "fixtures/minimal");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--output" && argv[i + 1]) output = resolve(argv[++i]);
    else if (a === "--runs" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--runs must be a positive integer");
      }
      runs = n;
    } else if (a === "--fixture-root" && argv[i + 1]) {
      fixtureRoot = resolve(argv[++i]);
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
  }
  return { output, runs, help, fixtureRoot };
}

function resolveGoldenQuery(s: GoldenScenario): {
  sql: string;
  bindValues: unknown[];
} {
  if (s.sql !== undefined) {
    if (s.params !== undefined) {
      throw new Error(
        `Golden scenario "${s.id}": params only allowed with recipe`,
      );
    }
    return { sql: s.sql, bindValues: [] };
  }
  if (s.recipe !== undefined) {
    const sql = getQueryRecipeSql(s.recipe);
    if (sql === undefined) {
      throw new Error(`Golden scenario "${s.id}": unknown recipe`);
    }
    const resolved = resolveRecipeParams({
      recipeId: s.recipe,
      declared: getQueryRecipeParams(s.recipe),
      provided: s.params,
    });
    if (!resolved.ok) {
      throw new Error(`Golden scenario "${s.id}": ${resolved.error}`);
    }
    return { sql, bindValues: resolved.values };
  }
  throw new Error(`Golden scenario "${s.id}": missing sql or recipe`);
}

function runMcpOnArm(
  prompt: string,
  sql: string,
  bindValues: unknown[],
): ArmRunMetrics {
  const t0 = performance.now();
  const rows = queryRows(sql, bindValues) as unknown[];
  const wallMs = performance.now() - t0;
  const toolSequence = ["query"];
  const estChars =
    Buffer.byteLength(prompt, "utf-8") + jsonCharLength(rows) + 32;
  return {
    wallMs,
    toolSequence,
    toolCallCount: toolSequence.length,
    resultCount: rows.length,
    estTokens: estimateTokens(estChars),
    success: rows.length > 0,
  };
}

function runMcpOffArm(prompt: string, probe: AgentEvalProbe): ArmRunMetrics {
  const trad = runTraditionalProbe(probe.traditional);
  const toolSequence = traditionalToolSequence(trad.filesRead);
  const estChars =
    Buffer.byteLength(prompt, "utf-8") +
    jsonCharLength(trad.results) +
    trad.bytesRead / 4;
  return {
    wallMs: trad.wallMs,
    toolSequence,
    toolCallCount: toolSequence.length,
    resultCount: trad.results.length,
    estTokens: estimateTokens(estChars),
    success: trad.results.length > 0,
  };
}

function runProbeOnce(
  probe: AgentEvalProbe,
  goldenById: Map<string, GoldenScenario>,
): ScenarioComparison {
  const golden = goldenById.get(probe.goldenId);
  if (golden === undefined) {
    throw new Error(
      `Probe "${probe.id}": unknown goldenId "${probe.goldenId}"`,
    );
  }
  const prompt = golden.prompt ?? probe.id;
  const { sql, bindValues } = resolveGoldenQuery(golden);
  const mcpOn = runMcpOnArm(prompt, sql, bindValues);
  const mcpOff = runMcpOffArm(prompt, probe);
  const success = mcpOn.success && mcpOff.success;
  return {
    id: probe.id,
    prompt,
    mcpOn: { ...mcpOn, success: success && mcpOn.success },
    mcpOff: { ...mcpOff, success: success && mcpOff.success },
    delta: {
      toolCallCount: mcpOff.toolCallCount - mcpOn.toolCallCount,
      wallMs: mcpOff.wallMs - mcpOn.wallMs,
      estTokens: mcpOff.estTokens - mcpOn.estTokens,
    },
  };
}

function summarize(
  scenarios: ScenarioComparison[],
): AgentEvalComparison["summary"] {
  let mcpOnTotalToolCalls = 0;
  let mcpOffTotalToolCalls = 0;
  let mcpOnTotalWallMs = 0;
  let mcpOffTotalWallMs = 0;
  let mcpOnTotalEstTokens = 0;
  let mcpOffTotalEstTokens = 0;
  let successCount = 0;
  for (const s of scenarios) {
    mcpOnTotalToolCalls += s.mcpOn.toolCallCount;
    mcpOffTotalToolCalls += s.mcpOff.toolCallCount;
    mcpOnTotalWallMs += s.mcpOn.wallMs;
    mcpOffTotalWallMs += s.mcpOff.wallMs;
    mcpOnTotalEstTokens += s.mcpOn.estTokens;
    mcpOffTotalEstTokens += s.mcpOff.estTokens;
    if (s.mcpOn.success && s.mcpOff.success) successCount++;
  }
  return {
    mcpOnTotalToolCalls,
    mcpOffTotalToolCalls,
    mcpOnTotalWallMs,
    mcpOffTotalWallMs,
    mcpOnTotalEstTokens,
    mcpOffTotalEstTokens,
    successCount,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: bun scripts/agent-eval/run-probes.ts [options]

Deterministic A/B probe: codemap query (MCP-on arm) vs glob+read+grep (MCP-off arm).
Indexes fixtures/minimal by default; writes comparison JSON locally (no upload).

Options:
  --output FILE       Output JSON path (default: .agent-eval/comparison.json)
  --runs N            Repeat each probe N times and average metrics (default: 1)
  --fixture-root DIR  Corpus to index (default: fixtures/minimal)
  -h, --help
`);
    process.exit(0);
  }

  const probesRaw = readFileSync(join(EVAL_DIR, "scenarios.json"), "utf-8");
  const { probes } = parseProbesJson(probesRaw);
  const goldenRaw = readFileSync(
    join(REPO_ROOT, "fixtures/golden/scenarios.json"),
    "utf-8",
  );
  const { scenarios: goldenScenarios } = parseScenariosJson(goldenRaw);
  const goldenById = new Map(goldenScenarios.map((s) => [s.id, s]));

  process.env.CODEMAP_ROOT = args.fixtureRoot;

  const cm = await createCodemap({ root: args.fixtureRoot });
  await cm.index({ mode: "full", quiet: true });

  const aggregated: ScenarioComparison[] = probes.map((probe) => {
    const samples: ScenarioComparison[] = [];
    for (let i = 0; i < args.runs; i++) {
      samples.push(runProbeOnce(probe, goldenById));
    }
    if (args.runs === 1) return samples[0]!;
    return averageSamples(probe.id, samples);
  });

  const report: AgentEvalComparison = {
    generatedAt: new Date().toISOString(),
    mode: "probe",
    fixtureRoot: args.fixtureRoot,
    runs: args.runs,
    scenarios: aggregated,
    summary: summarize(aggregated),
  };

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`\n  agent-eval: wrote ${args.output}`);
  console.log(
    `  summary: mcp-on ${report.summary.mcpOnTotalToolCalls} tool calls, mcp-off ${report.summary.mcpOffTotalToolCalls} (${report.summary.successCount}/${probes.length} scenarios ok)\n`,
  );
}

function averageSamples(
  id: string,
  samples: ScenarioComparison[],
): ScenarioComparison {
  const n = samples.length;
  const prompt = samples[0]!.prompt;
  const avgArm = (
    pick: (s: ScenarioComparison) => ArmRunMetrics,
  ): ArmRunMetrics => {
    const first = pick(samples[0]!);
    let wallMs = 0;
    let toolCallCount = 0;
    let resultCount = 0;
    let estTokens = 0;
    let success = true;
    for (const s of samples) {
      const arm = pick(s);
      wallMs += arm.wallMs;
      toolCallCount += arm.toolCallCount;
      resultCount += arm.resultCount;
      estTokens += arm.estTokens;
      success &&= arm.success;
    }
    return {
      wallMs: wallMs / n,
      toolSequence: first.toolSequence,
      toolCallCount: toolCallCount / n,
      resultCount: resultCount / n,
      estTokens: estTokens / n,
      success,
    };
  };
  const mcpOn = avgArm((s) => s.mcpOn);
  const mcpOff = avgArm((s) => s.mcpOff);
  return {
    id,
    prompt,
    mcpOn,
    mcpOff,
    delta: {
      toolCallCount: mcpOff.toolCallCount - mcpOn.toolCallCount,
      wallMs: mcpOff.wallMs - mcpOn.wallMs,
      estTokens: mcpOff.estTokens - mcpOn.estTokens,
    },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
