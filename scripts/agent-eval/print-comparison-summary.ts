import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { LiveLogComparison } from "./compare-live-logs";
import type { AgentEvalComparison } from "./run-probes";

type ComparisonReport = AgentEvalComparison | LiveLogComparison;

function isLogComparison(v: ComparisonReport): v is LiveLogComparison {
  return v.mode === "log";
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
    lines.push(
      `**Totals:** MCP-on ${report.summary.mcpOnTotalToolCalls} tool calls / ${report.summary.mcpOnTotalEstTokens} est. tokens; MCP-off ${report.summary.mcpOffTotalToolCalls} / ${report.summary.mcpOffTotalEstTokens}.`,
    );
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
      ? `live MCP handlers (${(report.mcpTools ?? []).join(", ") || "query, query_recipe"})`
      : "probe (queryRows)";
  lines.push(
    `**Totals (${modeNote}):** MCP-on ${report.summary.mcpOnTotalToolCalls} tool calls / ${report.summary.mcpOnTotalEstTokens} est. tokens; MCP-off ${report.summary.mcpOffTotalToolCalls} / ${report.summary.mcpOffTotalEstTokens}; ${report.summary.successCount}/${report.scenarios.length} scenarios ok.`,
  );
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
  const raw = readFileSync(args.input, "utf-8");
  const report = JSON.parse(raw) as ComparisonReport;
  process.stdout.write(formatComparisonMarkdown(report));
}

if (import.meta.main) {
  main();
}
