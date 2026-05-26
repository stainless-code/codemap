import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAgentLogFile } from "./parse-agent-log";
import type { ParsedAgentLog } from "./parse-agent-log";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(EVAL_DIR, "../..");

export interface LogArmRecord extends ParsedAgentLog {
  logPath: string;
}

export interface LogScenarioComparison {
  id: string;
  mcpOn: LogArmRecord;
  mcpOff: LogArmRecord;
  delta: {
    toolCallCount: number;
    estTokens: number;
    wallMs?: number;
  };
}

export interface LiveLogComparison {
  generatedAt: string;
  mode: "log";
  scenarios: LogScenarioComparison[];
  summary: {
    mcpOnTotalToolCalls: number;
    mcpOffTotalToolCalls: number;
    mcpOnTotalEstTokens: number;
    mcpOffTotalEstTokens: number;
    mcpOnTotalWallMs?: number;
    mcpOffTotalWallMs?: number;
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
  let output = join(REPO_ROOT, ".agent-eval/log-comparison.json");
  let mcpOnLog = "";
  let mcpOffLog = "";
  let id = "session";
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--output") {
      output = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--mcp-on") {
      mcpOnLog = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--mcp-off") {
      mcpOffLog = resolve(optValue(argv, i, a));
      i++;
    } else if (a === "--id") {
      id = optValue(argv, i, a);
      i++;
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
  }
  return { output, mcpOnLog, mcpOffLog, id, help };
}

export function compareLogArms(
  mcpOnPath: string,
  mcpOffPath: string,
  id = "session",
): LogScenarioComparison {
  if (!existsSync(mcpOnPath)) {
    throw new Error(`compare-live-logs: MCP-on log not found: ${mcpOnPath}`);
  }
  if (!existsSync(mcpOffPath)) {
    throw new Error(`compare-live-logs: MCP-off log not found: ${mcpOffPath}`);
  }
  const mcpOnParsed = parseAgentLogFile(mcpOnPath);
  const mcpOffParsed = parseAgentLogFile(mcpOffPath);
  return buildLogScenario(id, mcpOnPath, mcpOffPath, mcpOnParsed, mcpOffParsed);
}

function buildLogScenario(
  id: string,
  mcpOnPath: string,
  mcpOffPath: string,
  mcpOnParsed: ParsedAgentLog,
  mcpOffParsed: ParsedAgentLog,
): LogScenarioComparison {
  const mcpOn: LogArmRecord = { logPath: mcpOnPath, ...mcpOnParsed };
  const mcpOff: LogArmRecord = { logPath: mcpOffPath, ...mcpOffParsed };
  const delta: LogScenarioComparison["delta"] = {
    toolCallCount: mcpOff.toolCallCount - mcpOn.toolCallCount,
    estTokens: mcpOff.estTokens - mcpOn.estTokens,
  };
  if (mcpOn.wallMs !== undefined && mcpOff.wallMs !== undefined) {
    delta.wallMs = mcpOff.wallMs - mcpOn.wallMs;
  }
  return { id, mcpOn, mcpOff, delta };
}

export function summarizeLogComparison(
  scenarios: LogScenarioComparison[],
): LiveLogComparison["summary"] {
  let mcpOnTotalToolCalls = 0;
  let mcpOffTotalToolCalls = 0;
  let mcpOnTotalEstTokens = 0;
  let mcpOffTotalEstTokens = 0;
  let mcpOnTotalWallMs = 0;
  let mcpOffTotalWallMs = 0;
  let wallMsCount = 0;
  for (const s of scenarios) {
    mcpOnTotalToolCalls += s.mcpOn.toolCallCount;
    mcpOffTotalToolCalls += s.mcpOff.toolCallCount;
    mcpOnTotalEstTokens += s.mcpOn.estTokens;
    mcpOffTotalEstTokens += s.mcpOff.estTokens;
    if (s.mcpOn.wallMs !== undefined && s.mcpOff.wallMs !== undefined) {
      mcpOnTotalWallMs += s.mcpOn.wallMs;
      mcpOffTotalWallMs += s.mcpOff.wallMs;
      wallMsCount++;
    }
  }
  return {
    mcpOnTotalToolCalls,
    mcpOffTotalToolCalls,
    mcpOnTotalEstTokens,
    mcpOffTotalEstTokens,
    ...(wallMsCount > 0 ? { mcpOnTotalWallMs, mcpOffTotalWallMs } : {}),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: bun scripts/agent-eval/compare-live-logs.ts [options]

Compare exported agent session logs (MCP-on vs MCP-off).

Options:
  --mcp-on FILE   Log export with codemap MCP enabled
  --mcp-off FILE  Log export without codemap MCP (glob/read/grep)
  --output FILE   Output JSON (default: .agent-eval/log-comparison.json)
  --id ID         Scenario label (default: session)
  -h, --help
`);
    process.exit(0);
  }
  if (args.mcpOnLog === "" || args.mcpOffLog === "") {
    console.error("compare-live-logs: --mcp-on and --mcp-off are required");
    process.exit(1);
  }
  let scenario: LogScenarioComparison;
  try {
    scenario = compareLogArms(args.mcpOnLog, args.mcpOffLog, args.id);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const report: LiveLogComparison = {
    generatedAt: new Date().toISOString(),
    mode: "log",
    scenarios: [scenario],
    summary: summarizeLogComparison([scenario]),
  };
  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`\n  agent-eval: wrote ${args.output}`);
  console.log(
    `  summary: mcp-on ${report.summary.mcpOnTotalToolCalls} tool calls, mcp-off ${report.summary.mcpOffTotalToolCalls}\n`,
  );
  if (report.summary.mcpOnTotalToolCalls === 0) {
    console.error(
      "compare-live-logs: MCP-on export has 0 tool calls — check the log path and format",
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
