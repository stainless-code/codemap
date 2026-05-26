import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../../src/api";
import { queryRows } from "../../src/application/index-engine";
import type { RecipeParamValue } from "../../src/application/recipe-params";
import { resolveCodemapConfig } from "../../src/config";
import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import { runGoldenSetup } from "../query-golden/run-setup";
import { parseScenariosJson } from "../query-golden/schema";
import type { GoldenScenario } from "../query-golden/schema";
import { runLiveMcpArm } from "./live-mcp-arm";
import {
  ensureLiveEvalMcpToolsEnv,
  resolveLiveEvalMcpTools,
} from "./mcp-allowlist";
import {
  estimateProbeTokens,
  mcpOffPayloadChars,
  mcpOnPayloadChars,
} from "./probe-tokens";
import { parseProbesJson } from "./schema";
import type { AgentEvalProbe } from "./schema";
import {
  runTraditionalProbe,
  traditionalToolSequence,
} from "./traditional-probe";

export type AgentEvalMode = "probe" | "live";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(EVAL_DIR, "../..");

/** Per-arm metrics for one probe run (MCP-on query or MCP-off glob/read/grep). */
export interface ArmRunMetrics {
  /** Elapsed wall time for the arm, in milliseconds. */
  wallMs: number;
  /** Ordered tool names invoked (e.g. `["query"]` or `["glob","read","grep"]`). */
  toolSequence: string[];
  /** Length of `toolSequence`. */
  toolCallCount: number;
  /** Rows or grep hits returned (non-empty ⇒ `success`). */
  resultCount: number;
  /** Estimated tokens: `(prompt + payload) chars / 4`, rounded up. */
  estTokens: number;
  /** True when `resultCount > 0`. */
  success: boolean;
  /** Live MCP handler error when `success` is false and the handler returned `ok: false`. */
  error?: string;
}

/** One probe scenario: both arms plus deltas (`mcpOff − mcpOn`). */
export interface ScenarioComparison {
  id: string;
  prompt: string;
  mcpOn: ArmRunMetrics;
  mcpOff: ArmRunMetrics;
  /** Both arms returned at least one row. */
  scenarioSuccess: boolean;
  delta: {
    toolCallCount: number;
    wallMs: number;
    estTokens: number;
  };
}

/** Full comparison report written to local JSON (dev/CI only). */
export interface AgentEvalComparison {
  /** ISO-8601 timestamp when the report was generated. */
  generatedAt: string;
  /** `probe` = queryRows; `live` = transport-agnostic MCP handlers. */
  mode: AgentEvalMode;
  /** Eval allowlist subset when `mode` is `live` (not full MCP server registration). */
  mcpTools?: readonly string[];
  /** Indexed corpus root passed to `--fixture-root`. */
  fixtureRoot: string;
  /** Repeat count per probe (`--runs` / `AGENT_EVAL_RUNS`). */
  runs: number;
  scenarios: ScenarioComparison[];
  /** Per-arm sums across scenarios (`successCount` counts `scenarioSuccess`). */
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

function optValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (!v || v.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return v;
}

function parseArgs(argv: string[]) {
  let output = join(REPO_ROOT, ".agent-eval/comparison.json");
  let runs = 1;
  let help = false;
  let skipIndex = false;
  let fixtureRoot = join(REPO_ROOT, "fixtures/minimal");
  let scenariosPath = join(REPO_ROOT, "fixtures/golden/scenarios.json");
  let probesPath = join(EVAL_DIR, "scenarios.json");
  let mode: AgentEvalMode = "probe";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--skip-index") skipIndex = true;
    else if (a === "--mode") {
      const v = optValue(argv, i, a);
      i++;
      if (v !== "probe" && v !== "live") {
        throw new Error('--mode must be "probe" or "live"');
      }
      mode = v;
    } else if (a === "--output") {
      output = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--runs") {
      const n = Number(optValue(argv, i, a));
      i++;
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--runs must be a positive integer");
      }
      runs = n;
    } else if (a === "--fixture-root") {
      fixtureRoot = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--scenarios") {
      scenariosPath = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--probes") {
      probesPath = resolve(optValue(argv, i, a));
      i++;
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
  }
  return {
    output,
    runs,
    help,
    skipIndex,
    fixtureRoot,
    scenariosPath,
    probesPath,
    mode,
  };
}

function runMcpOnArm(
  prompt: string,
  sql: string,
  bindValues: RecipeParamValue[],
): ArmRunMetrics {
  const t0 = performance.now();
  const rows = queryRows(sql, bindValues) as unknown[];
  const wallMs = performance.now() - t0;
  const toolSequence = ["query"];
  return {
    wallMs,
    toolSequence,
    toolCallCount: toolSequence.length,
    resultCount: rows.length,
    estTokens: estimateProbeTokens(
      prompt,
      mcpOnPayloadChars(sql, rows, bindValues),
    ),
    success: rows.length > 0,
    ...(rows.length === 0 ? { error: "query returned 0 rows" } : {}),
  };
}

function runMcpOffArm(prompt: string, probe: AgentEvalProbe): ArmRunMetrics {
  const trad = runTraditionalProbe(probe.traditional);
  const toolSequence = traditionalToolSequence(trad.filesRead);
  return {
    wallMs: trad.wallMs,
    toolSequence,
    toolCallCount: toolSequence.length,
    resultCount: trad.results.length,
    estTokens: estimateProbeTokens(
      prompt,
      mcpOffPayloadChars(trad.bytesRead, trad.results),
    ),
    success: trad.results.length > 0,
  };
}

export function runProbeOnce(
  probe: AgentEvalProbe,
  goldenById: Map<string, GoldenScenario>,
  mode: AgentEvalMode = "probe",
  fixtureRoot?: string,
): ScenarioComparison {
  const golden = goldenById.get(probe.goldenId);
  if (golden === undefined) {
    throw new Error(
      `Probe "${probe.id}": unknown goldenId "${probe.goldenId}"`,
    );
  }
  const prompt = golden.prompt ?? probe.id;
  let mcpOn: ArmRunMetrics;
  if (mode === "live") {
    if (fixtureRoot === undefined) {
      throw new Error("runProbeOnce: fixtureRoot required when mode is live");
    }
    mcpOn = runLiveMcpArm(golden, fixtureRoot, prompt);
  } else {
    const { sql, bindValues } = resolveGoldenQuery(golden);
    mcpOn = runMcpOnArm(prompt, sql, bindValues);
  }
  const mcpOff = runMcpOffArm(prompt, probe);
  return {
    id: probe.id,
    prompt,
    mcpOn,
    mcpOff,
    scenarioSuccess: mcpOn.success && mcpOff.success,
    delta: {
      toolCallCount: mcpOff.toolCallCount - mcpOn.toolCallCount,
      wallMs: mcpOff.wallMs - mcpOn.wallMs,
      estTokens: mcpOff.estTokens - mcpOn.estTokens,
    },
  };
}

export function summarize(
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
    if (s.scenarioSuccess) successCount++;
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

export function allProbesSucceeded(
  successCount: number,
  probeCount: number,
): boolean {
  return successCount === probeCount;
}

export function applyProbeExitCode(
  successCount: number,
  probeCount: number,
): void {
  if (!allProbesSucceeded(successCount, probeCount)) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: bun scripts/agent-eval/run-probes.ts [options]

A/B probe: MCP-on arm vs glob+read+grep (MCP-off arm). Indexes fixtures/minimal by default.

Options:
  --mode MODE         probe (queryRows, default) or live (handleQuery / handleQueryRecipe)
  --output FILE       Output JSON path (default: .agent-eval/comparison.json)
  --runs N            Repeat each probe N times; averages wallMs/estTokens (toolSequence from run 1)
  --fixture-root DIR  Corpus to index (default: fixtures/minimal)
  --scenarios FILE    Golden scenarios JSON for SQL/prompts (default: fixtures/golden/scenarios.json)
  --probes FILE       Probe definitions JSON (default: scripts/agent-eval/scenarios.json)
  --skip-index        Skip full index when .codemap/index.db already exists (CI reuse after test:golden)
  -h, --help

Live mode sets CODEMAP_MCP_TOOLS=query,query_recipe when unset or blank.
`);
    process.exit(0);
  }

  if (!existsSync(args.probesPath)) {
    throw new Error(`Probes file not found: ${args.probesPath}`);
  }
  if (!existsSync(args.scenariosPath)) {
    throw new Error(`Scenarios file not found: ${args.scenariosPath}`);
  }
  const probesRaw = readFileSync(args.probesPath, "utf-8");
  const { probes } = parseProbesJson(probesRaw);
  const goldenRaw = readFileSync(args.scenariosPath, "utf-8");
  const { setup: goldenSetup, scenarios: goldenScenarios } =
    parseScenariosJson(goldenRaw);
  const goldenById = new Map(goldenScenarios.map((s) => [s.id, s]));

  for (const probe of probes) {
    if (!goldenById.has(probe.goldenId)) {
      throw new Error(
        `Probe "${probe.id}": goldenId "${probe.goldenId}" not found in ${args.scenariosPath}`,
      );
    }
  }

  const priorCodeMapRoot = process.env.CODEMAP_ROOT;
  const priorMcpTools = process.env.CODEMAP_MCP_TOOLS;
  process.env.CODEMAP_ROOT = args.fixtureRoot;
  if (args.mode === "live") {
    ensureLiveEvalMcpToolsEnv(process.env);
  }

  try {
    const cm = await createCodemap({ root: args.fixtureRoot });
    const dbPath = resolveCodemapConfig(
      args.fixtureRoot,
      undefined,
    ).databasePath;
    if (args.skipIndex) {
      if (!existsSync(dbPath)) {
        throw new Error(
          `--skip-index: no index at ${dbPath}; run index first or omit --skip-index`,
        );
      }
    } else {
      await cm.index({ mode: "full", quiet: true });
    }
    if (goldenSetup.length > 0) {
      runGoldenSetup(goldenSetup, args.fixtureRoot);
    }

    const aggregated: ScenarioComparison[] = probes.map((probe) => {
      const samples: ScenarioComparison[] = [];
      for (let i = 0; i < args.runs; i++) {
        samples.push(
          runProbeOnce(probe, goldenById, args.mode, args.fixtureRoot),
        );
      }
      if (args.runs === 1) return samples[0]!;
      return averageSamples(probe.id, samples);
    });

    const report: AgentEvalComparison = {
      generatedAt: new Date().toISOString(),
      mode: args.mode,
      fixtureRoot: args.fixtureRoot,
      runs: args.runs,
      ...(args.mode === "live"
        ? { mcpTools: resolveLiveEvalMcpTools(process.env) }
        : {}),
      scenarios: aggregated,
      summary: summarize(aggregated),
    };

    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    console.log(`\n  agent-eval: wrote ${args.output}`);
    console.log(
      `  summary: mcp-on ${report.summary.mcpOnTotalToolCalls} tool calls, mcp-off ${report.summary.mcpOffTotalToolCalls} (${report.summary.successCount}/${probes.length} scenarios ok)\n`,
    );
    for (const s of aggregated) {
      if (s.mcpOn.error !== undefined) {
        console.error(`  ${s.id} MCP-on: ${s.mcpOn.error}`);
      }
      if (s.mcpOff.error !== undefined) {
        console.error(`  ${s.id} MCP-off: ${s.mcpOff.error}`);
      }
    }

    applyProbeExitCode(report.summary.successCount, probes.length);
  } finally {
    if (priorCodeMapRoot === undefined) {
      delete process.env.CODEMAP_ROOT;
    } else {
      process.env.CODEMAP_ROOT = priorCodeMapRoot;
    }
    if (priorMcpTools === undefined) {
      delete process.env.CODEMAP_MCP_TOOLS;
    } else {
      process.env.CODEMAP_MCP_TOOLS = priorMcpTools;
    }
  }
}

export function averageSamples(
  id: string,
  samples: ScenarioComparison[],
): ScenarioComparison {
  const n = samples.length;
  if (n === 0) {
    throw new Error("averageSamples requires at least one sample");
  }
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
    let error: string | undefined;
    for (const s of samples) {
      const arm = pick(s);
      wallMs += arm.wallMs;
      toolCallCount += arm.toolCallCount;
      resultCount += arm.resultCount;
      estTokens += arm.estTokens;
      success &&= arm.success;
      if (arm.error !== undefined) {
        error ??= arm.error;
      }
    }
    return {
      wallMs: wallMs / n,
      toolSequence: first.toolSequence,
      toolCallCount: Math.round(toolCallCount / n),
      resultCount: success ? Math.round(resultCount / n) : 0,
      estTokens: Math.ceil(estTokens / n),
      success,
      ...(error !== undefined ? { error } : {}),
    };
  };
  const mcpOn = avgArm((s) => s.mcpOn);
  const mcpOff = avgArm((s) => s.mcpOff);
  const scenarioSuccess = samples.every((s) => s.scenarioSuccess);
  return {
    id,
    prompt,
    mcpOn,
    mcpOff,
    scenarioSuccess,
    delta: {
      toolCallCount: mcpOff.toolCallCount - mcpOn.toolCallCount,
      wallMs: mcpOff.wallMs - mcpOn.wallMs,
      estTokens: mcpOff.estTokens - mcpOn.estTokens,
    },
  };
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.exitCode === 1) process.exit(1);
    });
}
