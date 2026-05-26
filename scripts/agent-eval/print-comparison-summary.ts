import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { LiveLogComparison } from "./compare-live-logs";
import type { AgentEvalComparison } from "./run-probes";

type ComparisonReport = AgentEvalComparison | LiveLogComparison;

function isLogComparison(v: ComparisonReport): v is LiveLogComparison {
  return v.mode === "log";
}

function isArmMetrics(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const arm = v as Record<string, unknown>;
  return (
    typeof arm.toolCallCount === "number" && typeof arm.estTokens === "number"
  );
}

function isProbeLiveScenario(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== "string") return false;
  if (!isArmMetrics(s.mcpOn) || !isArmMetrics(s.mcpOff)) return false;
  const delta = s.delta;
  if (delta === null || typeof delta !== "object") return false;
  const d = delta as Record<string, unknown>;
  return typeof d.toolCallCount === "number" && typeof d.estTokens === "number";
}

function isLogScenario(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.id !== "string") return false;
  if (!isArmMetrics(s.mcpOn) || !isArmMetrics(s.mcpOff)) return false;
  const delta = s.delta;
  if (delta === null || typeof delta !== "object") return false;
  const d = delta as Record<string, unknown>;
  return typeof d.toolCallCount === "number" && typeof d.estTokens === "number";
}

function isComparisonReport(v: unknown): v is ComparisonReport {
  if (v === null || typeof v !== "object") return false;
  const row = v as Record<string, unknown>;
  const mode = row.mode;
  if (mode !== "probe" && mode !== "live" && mode !== "log") return false;
  if (typeof row.generatedAt !== "string") return false;
  if (!Array.isArray(row.scenarios) || row.scenarios.length === 0) {
    return false;
  }
  if (row.summary === null || typeof row.summary !== "object") return false;
  const summary = row.summary as Record<string, unknown>;
  if (mode === "log") {
    if (
      typeof summary.mcpOnTotalToolCalls !== "number" ||
      typeof summary.mcpOffTotalToolCalls !== "number" ||
      typeof summary.mcpOnTotalEstTokens !== "number" ||
      typeof summary.mcpOffTotalEstTokens !== "number"
    ) {
      return false;
    }
    const hasOnWall = summary.mcpOnTotalWallMs !== undefined;
    const hasOffWall = summary.mcpOffTotalWallMs !== undefined;
    if (hasOnWall !== hasOffWall) return false;
    if (hasOnWall && typeof summary.mcpOnTotalWallMs !== "number") return false;
    if (hasOffWall && typeof summary.mcpOffTotalWallMs !== "number")
      return false;
    return row.scenarios.every(isLogScenario);
  }
  if (
    typeof summary.mcpOnTotalToolCalls !== "number" ||
    typeof summary.mcpOffTotalToolCalls !== "number" ||
    typeof summary.mcpOnTotalEstTokens !== "number" ||
    typeof summary.mcpOffTotalEstTokens !== "number" ||
    typeof summary.successCount !== "number"
  ) {
    return false;
  }
  return row.scenarios.every(isProbeLiveScenario);
}

function fmt(n: number, digits = 0): string {
  if (digits === 0) return String(Math.round(n));
  return n.toFixed(digits);
}

export function formatComparisonMarkdown(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(`<!-- generated ${report.generatedAt} -->`);
  lines.push("");
  lines.push(
    `| Scenario | MCP-on tools | MCP-off tools | Δ tools | MCP-on tokens | MCP-off tokens | Δ tokens |`,
  );
  lines.push(
    `| -------- | ------------ | ------------- | ------- | ------------- | -------------- | -------- |`,
  );

  if (isLogComparison(report)) {
    for (const s of report.scenarios) {
      lines.push(
        `| ${s.id} | ${s.mcpOn.toolCallCount} | ${s.mcpOff.toolCallCount} | ${s.delta.toolCallCount >= 0 ? "+" : ""}${s.delta.toolCallCount} | ${s.mcpOn.estTokens} | ${s.mcpOff.estTokens} | ${s.delta.estTokens >= 0 ? "+" : ""}${s.delta.estTokens} |`,
      );
    }
    lines.push("");
    let totals = `**Totals (log exports):** MCP-on ${report.summary.mcpOnTotalToolCalls} tool calls / ${report.summary.mcpOnTotalEstTokens} est. tokens; MCP-off ${report.summary.mcpOffTotalToolCalls} / ${report.summary.mcpOffTotalEstTokens}`;
    if (
      report.summary.mcpOnTotalWallMs !== undefined &&
      report.summary.mcpOffTotalWallMs !== undefined
    ) {
      totals += `; wall ms MCP-on ${Math.round(report.summary.mcpOnTotalWallMs)} / MCP-off ${Math.round(report.summary.mcpOffTotalWallMs)}`;
    }
    lines.push(`${totals}.`);
    return `${lines.join("\n")}\n`;
  }

  for (const s of report.scenarios) {
    lines.push(
      `| ${s.id} | ${s.mcpOn.toolCallCount} | ${s.mcpOff.toolCallCount} | ${s.delta.toolCallCount >= 0 ? "+" : ""}${fmt(s.delta.toolCallCount)} | ${s.mcpOn.estTokens} | ${s.mcpOff.estTokens} | ${s.delta.estTokens >= 0 ? "+" : ""}${fmt(s.delta.estTokens)} |`,
    );
  }
  lines.push("");
  const modeNote =
    report.mode === "live"
      ? `live MCP handlers (eval subset: ${(report.mcpTools ?? []).join(", ") || "query, query_recipe"})`
      : "probe (queryRows)";
  lines.push(
    `**Totals (${modeNote}):** MCP-on ${report.summary.mcpOnTotalToolCalls} tool calls / ${report.summary.mcpOnTotalEstTokens} est. tokens; MCP-off ${report.summary.mcpOffTotalToolCalls} / ${report.summary.mcpOffTotalEstTokens}; ${report.summary.successCount}/${report.scenarios.length} scenarios ok.`,
  );
  const failures = report.scenarios.filter(
    (s) => !s.scenarioSuccess || s.mcpOn.error !== undefined || s.mcpOff.error,
  );
  if (failures.length > 0) {
    lines.push("");
    lines.push("**Failures:**");
    for (const s of failures) {
      if (s.mcpOn.error !== undefined) {
        lines.push(`- ${s.id} MCP-on: ${s.mcpOn.error}`);
      }
      if (s.mcpOff.error !== undefined) {
        lines.push(`- ${s.id} MCP-off: ${s.mcpOff.error}`);
      }
      if (
        s.mcpOn.error === undefined &&
        s.mcpOff.error === undefined &&
        !s.scenarioSuccess
      ) {
        lines.push(`- ${s.id}: scenario incomplete`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv: string[]) {
  let input = "";
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--input" || a === "-i") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) throw new Error(`${a} requires a value`);
      input = resolve(v);
      i++;
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
    else if (input === "") input = resolve(a);
  }
  return { input, help };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.input === "") {
    console.log(`Usage: bun scripts/agent-eval/print-comparison-summary.ts [--input] comparison.json

Print a markdown summary table for probe, live, or log comparison JSON.
`);
    process.exit(args.help ? 0 : 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(args.input, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`print-comparison-summary: invalid JSON: ${msg}`);
    process.exit(1);
  }
  if (!isComparisonReport(parsed)) {
    console.error(
      "print-comparison-summary: expected comparison JSON with mode probe|live|log and scenarios[]",
    );
    process.exit(1);
  }
  process.stdout.write(formatComparisonMarkdown(parsed));
}

if (import.meta.main) {
  main();
}
