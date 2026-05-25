import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import { parseAgentLog, parseAgentLogFile } from "./parse-agent-log";
import {
  estimateProbeTokens,
  mcpOffPayloadChars,
  mcpOnPayloadChars,
} from "./probe-tokens";
import {
  allProbesSucceeded,
  applyProbeExitCode,
  averageSamples,
  runProbeOnce,
  summarize,
} from "./run-probes";
import type { ArmRunMetrics, ScenarioComparison } from "./run-probes";
import { traditionalToolSequence } from "./traditional-probe";

const sampleLog = join(
  import.meta.dir,
  "../../fixtures/agent-eval/sample-cursor-log.json",
);

function arm(overrides: Partial<ArmRunMetrics> = {}): ArmRunMetrics {
  return {
    wallMs: 1,
    toolSequence: ["query"],
    toolCallCount: 1,
    resultCount: 1,
    estTokens: 10,
    success: true,
    ...overrides,
  };
}

function scenario(
  overrides: Partial<ScenarioComparison> & Pick<ScenarioComparison, "id">,
): ScenarioComparison {
  return {
    prompt: "p",
    mcpOn: arm(),
    mcpOff: arm({ toolSequence: ["glob", "grep"], toolCallCount: 2 }),
    scenarioSuccess: true,
    delta: { toolCallCount: 1, wallMs: 0, estTokens: 0 },
    ...overrides,
  };
}

describe("parse-agent-log", () => {
  it("parses entries-transcript JSON", () => {
    const parsed = parseAgentLogFile(sampleLog);
    expect(parsed.format).toBe("entries-transcript");
    expect(parsed.toolSequence).toEqual(["query"]);
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.promptChars).toBeGreaterThan(0);
    expect(parsed.estTokens).toBeGreaterThan(0);
  });

  it("parses array-transcript JSON", () => {
    const raw = JSON.stringify([
      { role: "user", content: "Where is X?" },
      { kind: "tool_call", tool: "query" },
    ]);
    const parsed = parseAgentLog(raw);
    expect(parsed.format).toBe("array-transcript");
    expect(parsed.toolSequence).toEqual(["query"]);
  });

  it("parses OpenAI-style messages with tool_calls", () => {
    const raw = JSON.stringify({
      messages: [
        { role: "user", content: "List components" },
        {
          role: "assistant",
          tool_calls: [
            {
              function: {
                name: "mcp_codemap_query",
                arguments: "{}",
              },
            },
          ],
        },
      ],
    });
    const parsed = parseAgentLog(raw);
    expect(parsed.format).toBe("messages-transcript");
    expect(parsed.toolSequence).toEqual(["query"]);
  });

  it("does not double-count tool_calls and kind tool_call on one entry", () => {
    const raw = JSON.stringify({
      entries: [
        {
          kind: "tool_call",
          tool: "query",
          role: "assistant",
          tool_calls: [{ function: { name: "mcp_codemap_show" } }],
        },
      ],
    });
    const parsed = parseAgentLog(raw);
    expect(parsed.toolSequence).toEqual(["show"]);
  });

  it("parses line-oriented tool logs with normalized names", () => {
    const raw = `USER: find createClient call sites
TOOL: Grep
TOOL: Read
TOOL: query
ASSISTANT: found 3 call sites`;
    const parsed = parseAgentLog(raw);
    expect(parsed.format).toBe("line-log");
    expect(parsed.toolSequence).toEqual(["grep", "read", "query"]);
    expect(parsed.toolCallCount).toBe(3);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAgentLog("{not json")).toThrow(/invalid JSON/);
  });
});

describe("probe-tokens", () => {
  it("counts SQL in MCP-on payload", () => {
    expect(mcpOnPayloadChars("SELECT 1", [{ n: 1 }])).toBeGreaterThan(8);
    const emptyRowsPayload = mcpOnPayloadChars("SELECT 1", []);
    expect(emptyRowsPayload).toBe(Buffer.byteLength("SELECT 1", "utf-8") + 2);
    expect(estimateProbeTokens("task", emptyRowsPayload)).toBe(
      Math.ceil((Buffer.byteLength("task", "utf-8") + emptyRowsPayload) / 4),
    );
  });

  it("uses bytesRead without double JSON charge for MCP-off", () => {
    const payload = mcpOffPayloadChars(400, [{ file_path: "a.ts" }]);
    expect(payload).toBeGreaterThan(400);
  });
});

describe("run-probes helpers", () => {
  it("resolveGoldenQuery resolves recipe probes", () => {
    const { sql, bindValues } = resolveGoldenQuery({
      id: "find-call-sites",
      recipe: "find-call-sites",
      params: { callee: "createClient" },
    });
    expect(sql).toContain("SELECT");
    expect(bindValues.length).toBeGreaterThan(0);
  });

  it("runProbeOnce throws on unknown goldenId", () => {
    expect(() =>
      runProbeOnce(
        {
          id: "missing",
          goldenId: "nope",
          traditional: { globs: ["**/*.ts"], regex: "x", mode: "files" },
        },
        new Map(),
      ),
    ).toThrow(/unknown goldenId/);
  });

  it("averageSamples averages metrics and keeps per-arm success", () => {
    const samples = [
      scenario({
        id: "p",
        mcpOn: arm({ wallMs: 2, success: true }),
        mcpOff: arm({ wallMs: 4, toolCallCount: 3, success: false }),
        scenarioSuccess: false,
      }),
      scenario({
        id: "p",
        mcpOn: arm({ wallMs: 4, success: true }),
        mcpOff: arm({ wallMs: 6, toolCallCount: 5, success: true }),
        scenarioSuccess: true,
      }),
    ];
    const avg = averageSamples("p", samples);
    expect(avg.mcpOn.wallMs).toBe(3);
    expect(avg.mcpOff.wallMs).toBe(5);
    expect(avg.mcpOn.success).toBe(true);
    expect(avg.mcpOff.success).toBe(false);
    expect(avg.scenarioSuccess).toBe(false);
  });

  it("summarize counts scenarioSuccess", () => {
    const summary = summarize([
      scenario({ id: "a", scenarioSuccess: true }),
      scenario({ id: "b", scenarioSuccess: false }),
    ]);
    expect(summary.successCount).toBe(1);
  });

  it("allProbesSucceeded requires every scenario", () => {
    expect(allProbesSucceeded(3, 3)).toBe(true);
    expect(allProbesSucceeded(2, 3)).toBe(false);
  });

  it("applyProbeExitCode sets process exitCode on partial failure", () => {
    process.exitCode = 0;
    applyProbeExitCode(2, 3);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    applyProbeExitCode(3, 3);
    expect(process.exitCode).toBe(0);
  });

  it("traditionalToolSequence includes glob and grep with zero reads", () => {
    expect(traditionalToolSequence(0)).toEqual(["glob", "grep"]);
  });
});

describe("run-probes smoke", () => {
  it("indexes fixtures/minimal and compares three probes", async () => {
    const { spawnSync } = await import("node:child_process");
    const out = join(import.meta.dir, "../../.agent-eval/test-comparison.json");
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dir, "run-probes.ts"),
        "--output",
        out,
        "--fixture-root",
        join(import.meta.dir, "../../fixtures/minimal"),
      ],
      { encoding: "utf-8", cwd: join(import.meta.dir, "../..") },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(await Bun.file(out).text()) as {
      scenarios: ScenarioComparison[];
      summary: { successCount: number; mcpOffTotalToolCalls: number };
    };
    expect(parsed.scenarios).toHaveLength(3);
    expect(parsed.summary.successCount).toBe(3);
    expect(parsed.summary.mcpOffTotalToolCalls).toBeGreaterThan(
      parsed.scenarios.reduce((n, s) => n + s.mcpOn.toolCallCount, 0),
    );
  }, 120_000);
});
