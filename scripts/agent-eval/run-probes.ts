import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../../src/api";
import { queryRows } from "../../src/application/index-engine";
import type { RecipeParamValue } from "../../src/application/recipe-params";
import { resolveCodemapConfig } from "../../src/config";
import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import { parseScenariosJson } from "../query-golden/schema";
import type { GoldenScenario } from "../query-golden/schema";
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
  /** Fixed `"probe"` — deterministic harness mode (no LLM). */
  mode: "probe";
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--skip-index") skipIndex = true;
    else if (a === "--output") {
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

Deterministic A/B probe: codemap query (MCP-on arm) vs glob+read+grep (MCP-off arm).
Indexes fixtures/minimal by default; writes comparison JSON locally (no upload).

Options:
  --output FILE       Output JSON path (default: .agent-eval/comparison.json)
  --runs N            Repeat each probe N times; averages wallMs/estTokens (toolSequence from run 1)
  --fixture-root DIR  Corpus to index (default: fixtures/minimal)
  --scenarios FILE    Golden scenarios JSON for SQL/prompts (default: fixtures/golden/scenarios.json)
  --probes FILE       Probe definitions JSON (default: scripts/agent-eval/scenarios.json)
  --skip-index        Skip full index when .codemap/index.db already exists (CI reuse after test:golden)
  -h, --help
`);
    process.exit(0);
  }

  const probesRaw = readFileSync(args.probesPath, "utf-8");
  const { probes } = parseProbesJson(probesRaw);
  const goldenRaw = readFileSync(args.scenariosPath, "utf-8");
  const { scenarios: goldenScenarios } = parseScenariosJson(goldenRaw);
  const goldenById = new Map(goldenScenarios.map((s) => [s.id, s]));

  for (const probe of probes) {
    if (!goldenById.has(probe.goldenId)) {
      throw new Error(
        `Probe "${probe.id}": goldenId "${probe.goldenId}" not found in ${args.scenariosPath}`,
      );
    }
  }

  const priorCodeMapRoot = process.env.CODEMAP_ROOT;
  process.env.CODEMAP_ROOT = args.fixtureRoot;

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

    applyProbeExitCode(report.summary.successCount, probes.length);
    if (process.exitCode === 1) process.exit(1);
  } finally {
    if (priorCodeMapRoot === undefined) {
      delete process.env.CODEMAP_ROOT;
    } else {
      process.env.CODEMAP_ROOT = priorCodeMapRoot;
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
  let mcpOnToolCallCount = 0;
  let mcpOffToolCallCount = 0;
  let mcpOnWallMs = 0;
  let mcpOffWallMs = 0;
  let mcpOnEstTokens = 0;
  let mcpOffEstTokens = 0;
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
      toolCallCount: Math.round(toolCallCount / n),
      resultCount: Math.round(resultCount / n),
      estTokens: Math.ceil(estTokens / n),
      success,
    };
  };
  for (const s of samples) {
    mcpOnWallMs += s.mcpOn.wallMs;
    mcpOffWallMs += s.mcpOff.wallMs;
    mcpOnToolCallCount += s.mcpOn.toolCallCount;
    mcpOffToolCallCount += s.mcpOff.toolCallCount;
    mcpOnEstTokens += s.mcpOn.estTokens;
    mcpOffEstTokens += s.mcpOff.estTokens;
  }
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
      toolCallCount: mcpOffToolCallCount / n - mcpOnToolCallCount / n,
      wallMs: mcpOffWallMs / n - mcpOnWallMs / n,
      estTokens: mcpOffEstTokens / n - mcpOnEstTokens / n,
    },
  };
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
