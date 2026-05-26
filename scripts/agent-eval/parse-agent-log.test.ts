import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../../src/config";
import { initCodemap } from "../../src/runtime";
import { resolveGoldenQuery } from "../query-golden/resolve-golden-query";
import { compareLogArms, summarizeLogComparison } from "./compare-live-logs";
import { runLiveMcpArm } from "./live-mcp-arm";
import {
  assertLiveEvalToolEnabled,
  defaultLiveEvalMcpToolsEnv,
  ensureLiveEvalMcpToolsEnv,
  requiredMcpToolForGolden,
} from "./mcp-allowlist";
import { jsonCharLength } from "./metrics";
import { parseAgentLog, parseAgentLogFile } from "./parse-agent-log";
import { formatComparisonMarkdown } from "./print-comparison-summary";
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
import { parseProbesJson } from "./schema";
import { resultCountFromToolPayload } from "./tool-payload";
import {
  runTraditionalProbe,
  traditionalToolSequence,
} from "./traditional-probe";

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

  it("counts tool args in log-mode token estimate", () => {
    const withoutArgs = parseAgentLog(
      JSON.stringify({
        entries: [
          { kind: "user", text: "q" },
          { kind: "tool_call", tool: "query" },
        ],
      }),
    );
    const withArgs = parseAgentLogFile(sampleLog);
    expect(withArgs.estTokens).toBeGreaterThan(withoutArgs.estTokens);
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

  it("parses tool_calls without assistant role", () => {
    const raw = JSON.stringify({
      entries: [{ tool_calls: [{ function: { name: "mcp_codemap_query" } }] }],
    });
    const parsed = parseAgentLog(raw);
    expect(parsed.toolSequence).toEqual(["query"]);
  });

  it("counts structured content part arrays in token estimate", () => {
    const plain = parseAgentLog(
      JSON.stringify({
        messages: [{ role: "user", content: "short" }],
      }),
    );
    const parts = parseAgentLog(
      JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Where is usePermissions defined?" },
            ],
          },
        ],
      }),
    );
    expect(parts.estTokens).toBeGreaterThan(plain.estTokens);
  });

  it("counts input_text content parts", () => {
    const parsed = parseAgentLog(
      JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "input_text", input_text: "longer user prompt" }],
          },
        ],
      }),
    );
    expect(parsed.promptChars).toBeGreaterThan(10);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAgentLog("{not json")).toThrow(/invalid JSON/);
  });

  it("throws on unsupported JSON shape without masking as invalid JSON", () => {
    expect(() => parseAgentLog("{}")).toThrow(/unsupported JSON shape/);
    expect(() => parseAgentLog("{}")).not.toThrow(/invalid JSON/);
  });
});

describe("probe-tokens", () => {
  it("counts SQL and bind values in MCP-on payload", () => {
    expect(mcpOnPayloadChars("SELECT 1", [1])).toBeGreaterThan(8);
    const withBinds = mcpOnPayloadChars("SELECT 1", [1], ["createClient"]);
    const withoutBinds = mcpOnPayloadChars("SELECT 1", [1], []);
    expect(withBinds).toBeGreaterThan(withoutBinds);
    const emptyRowsPayload = mcpOnPayloadChars("SELECT 1", []);
    expect(emptyRowsPayload).toBe(
      Buffer.byteLength("SELECT 1", "utf-8") +
        jsonCharLength([]) +
        jsonCharLength([]),
    );
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

  it("main rejects missing probes file", async () => {
    const { spawnSync } = await import("node:child_process");
    const fixtureRoot = join(import.meta.dir, "../../fixtures/minimal");
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dir, "run-probes.ts"),
        "--fixture-root",
        fixtureRoot,
        "--probes",
        join(fixtureRoot, "no-such-probes.json"),
      ],
      { encoding: "utf-8", cwd: join(import.meta.dir, "../..") },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Probes file not found");
  });

  it("runProbeOnce throws when live mode missing fixtureRoot", () => {
    expect(() =>
      runProbeOnce(
        {
          id: "p",
          goldenId: "symbol-usePermissions",
          traditional: { globs: ["**/*.ts"], regex: "x", mode: "files" },
        },
        new Map([
          [
            "symbol-usePermissions",
            {
              id: "symbol-usePermissions",
              sql: "SELECT 1",
            },
          ],
        ]),
        "live",
      ),
    ).toThrow(/fixtureRoot required/);
  });

  it("averageSamples rejects empty input", () => {
    expect(() => averageSamples("p", [])).toThrow(
      /requires at least one sample/,
    );
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

  it("averageSamples re-ceils averaged estTokens", () => {
    const samples = [
      scenario({
        id: "p",
        mcpOn: arm({ estTokens: 10 }),
        mcpOff: arm({ estTokens: 11, toolSequence: ["glob", "grep"] }),
      }),
      scenario({
        id: "p",
        mcpOn: arm({ estTokens: 11 }),
        mcpOff: arm({ estTokens: 12, toolSequence: ["glob", "grep"] }),
      }),
    ];
    const avg = averageSamples("p", samples);
    expect(Number.isInteger(avg.mcpOn.estTokens)).toBe(true);
    expect(Number.isInteger(avg.mcpOff.estTokens)).toBe(true);
    expect(avg.mcpOn.estTokens).toBe(11);
    expect(avg.mcpOff.estTokens).toBe(12);
  });

  it("averageSamples delta uses unrounded arm averages", () => {
    const samples = [
      scenario({
        id: "p",
        mcpOn: arm({ toolCallCount: 1 }),
        mcpOff: arm({ toolCallCount: 2, toolSequence: ["glob", "grep"] }),
      }),
      scenario({
        id: "p",
        mcpOn: arm({ toolCallCount: 1 }),
        mcpOff: arm({ toolCallCount: 4, toolSequence: ["glob", "grep"] }),
      }),
    ];
    const avg = averageSamples("p", samples);
    expect(avg.mcpOff.toolCallCount).toBe(3);
    expect(avg.mcpOn.toolCallCount).toBe(1);
    expect(avg.delta.toolCallCount).toBe(2);
  });

  it("traditionalToolSequence includes glob and grep with zero reads", () => {
    expect(traditionalToolSequence(0)).toEqual(["glob", "grep"]);
  });

  it("runTraditionalProbe rejects invalid regex", () => {
    const root = join(import.meta.dir, "../../fixtures/minimal");
    initCodemap(resolveCodemapConfig(root, undefined));
    expect(() =>
      runTraditionalProbe({
        globs: ["**/*.ts"],
        regex: "[",
        mode: "files",
      }),
    ).toThrow(/invalid traditional regex/);
  });

  it("runTraditionalProbe finds files in fixtures/minimal", () => {
    const root = join(import.meta.dir, "../../fixtures/minimal");
    initCodemap(resolveCodemapConfig(root, undefined));
    const result = runTraditionalProbe({
      globs: ["**/*.ts"],
      regex: "createClient",
      mode: "files",
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.filesRead).toBeGreaterThan(0);
  });
});

describe("parseProbesJson", () => {
  it("rejects invalid JSON", () => {
    expect(() => parseProbesJson("{")).toThrow(/invalid probes JSON/);
  });

  it("rejects invalid schema", () => {
    expect(() => parseProbesJson(JSON.stringify({ version: 2 }))).toThrow(
      /invalid probes file/,
    );
  });
});

describe("run-probes smoke", () => {
  it("exits non-zero when scenarioSuccess is incomplete", async () => {
    const { spawnSync } = await import("node:child_process");
    const fixtureRoot = join(import.meta.dir, "../../fixtures/minimal");
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-exit-"));
    const probesPath = join(tmp, "probes.json");
    const out = join(tmp, "comparison.json");
    writeFileSync(
      probesPath,
      JSON.stringify({
        version: 1,
        probes: [
          {
            id: "fail-traditional",
            goldenId: "symbol-usePermissions",
            traditional: {
              globs: ["**/*.ts"],
              regex: "zzz_nope_match_codemap_98765",
              mode: "files",
            },
          },
        ],
      }),
    );
    const args = [
      join(import.meta.dir, "run-probes.ts"),
      "--output",
      out,
      "--fixture-root",
      fixtureRoot,
      "--probes",
      probesPath,
    ];
    const indexDb = join(fixtureRoot, ".codemap", "index.db");
    if (existsSync(indexDb)) args.push("--skip-index");
    try {
      const result = spawnSync("bun", args, {
        encoding: "utf-8",
        cwd: join(import.meta.dir, "../.."),
      });
      expect(result.status).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("indexes fixtures/minimal and compares three probes", async () => {
    const { spawnSync } = await import("node:child_process");
    const fixtureRoot = join(import.meta.dir, "../../fixtures/minimal");
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-smoke-"));
    const out = join(tmp, "comparison.json");
    const indexDb = join(fixtureRoot, ".codemap", "index.db");
    const args = [
      join(import.meta.dir, "run-probes.ts"),
      "--output",
      out,
      "--fixture-root",
      fixtureRoot,
    ];
    if (existsSync(indexDb)) args.push("--skip-index");
    try {
      const result = spawnSync("bun", args, {
        encoding: "utf-8",
        cwd: join(import.meta.dir, "../.."),
      });
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
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it("indexes fixtures/minimal in live MCP mode", async () => {
    const { spawnSync } = await import("node:child_process");
    const fixtureRoot = join(import.meta.dir, "../../fixtures/minimal");
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-live-"));
    const out = join(tmp, "comparison.json");
    const indexDb = join(fixtureRoot, ".codemap", "index.db");
    const args = [
      join(import.meta.dir, "run-probes.ts"),
      "--mode",
      "live",
      "--output",
      out,
      "--fixture-root",
      fixtureRoot,
    ];
    if (existsSync(indexDb)) args.push("--skip-index");
    try {
      const result = spawnSync("bun", args, {
        encoding: "utf-8",
        cwd: join(import.meta.dir, "../.."),
        env: {
          ...process.env,
          CODEMAP_MCP_TOOLS: defaultLiveEvalMcpToolsEnv(),
        },
      });
      expect(result.status).toBe(0);
      const parsed = JSON.parse(await Bun.file(out).text()) as {
        mode: string;
        mcpTools?: string[];
        scenarios: ScenarioComparison[];
        summary: { successCount: number };
      };
      expect(parsed.mode).toBe("live");
      expect(parsed.mcpTools).toEqual(["query", "query_recipe"]);
      expect(parsed.scenarios).toHaveLength(3);
      expect(parsed.summary.successCount).toBe(3);
      expect(parsed.scenarios[2]!.mcpOn.toolSequence).toEqual(["query_recipe"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("live MCP arm", () => {
  it("requiredMcpToolForGolden picks query vs query_recipe", () => {
    expect(
      requiredMcpToolForGolden({
        id: "sql",
        sql: "SELECT 1",
      }),
    ).toBe("query");
    expect(
      requiredMcpToolForGolden({
        id: "recipe",
        recipe: "find-call-sites",
        params: { callee: "x" },
      }),
    ).toBe("query_recipe");
  });

  it("assertLiveEvalToolEnabled rejects trimmed allowlist", () => {
    const prior = process.env.CODEMAP_MCP_TOOLS;
    process.env.CODEMAP_MCP_TOOLS = "query";
    try {
      expect(() => assertLiveEvalToolEnabled("query_recipe")).toThrow(
        /not enabled/,
      );
    } finally {
      if (prior === undefined) delete process.env.CODEMAP_MCP_TOOLS;
      else process.env.CODEMAP_MCP_TOOLS = prior;
    }
  });

  it("ensureLiveEvalMcpToolsEnv applies default when blank", () => {
    const prior = process.env.CODEMAP_MCP_TOOLS;
    process.env.CODEMAP_MCP_TOOLS = "  ";
    try {
      ensureLiveEvalMcpToolsEnv(process.env);
      expect(process.env.CODEMAP_MCP_TOOLS).toBe(defaultLiveEvalMcpToolsEnv());
    } finally {
      if (prior === undefined) delete process.env.CODEMAP_MCP_TOOLS;
      else process.env.CODEMAP_MCP_TOOLS = prior;
    }
  });

  it("runLiveMcpArm returns rows via handleQuery", () => {
    const root = join(import.meta.dir, "../../fixtures/minimal");
    initCodemap(resolveCodemapConfig(root, undefined));
    const prior = process.env.CODEMAP_MCP_TOOLS;
    process.env.CODEMAP_MCP_TOOLS = defaultLiveEvalMcpToolsEnv();
    try {
      const metrics = runLiveMcpArm(
        {
          id: "symbol-usePermissions",
          prompt: "Where is usePermissions?",
          sql: "SELECT name FROM symbols WHERE name = 'usePermissions'",
        },
        root,
        "Where is usePermissions?",
      );
      expect(metrics.toolSequence).toEqual(["query"]);
      expect(metrics.success).toBe(true);
      expect(metrics.resultCount).toBeGreaterThan(0);
    } finally {
      if (prior === undefined) delete process.env.CODEMAP_MCP_TOOLS;
      else process.env.CODEMAP_MCP_TOOLS = prior;
    }
  });

  it("runLiveMcpArm returns rows via handleQueryRecipe", () => {
    const root = join(import.meta.dir, "../../fixtures/minimal");
    initCodemap(resolveCodemapConfig(root, undefined));
    const prior = process.env.CODEMAP_MCP_TOOLS;
    process.env.CODEMAP_MCP_TOOLS = defaultLiveEvalMcpToolsEnv();
    try {
      const metrics = runLiveMcpArm(
        {
          id: "find-call-sites",
          prompt: "call sites",
          recipe: "find-call-sites",
          params: { callee: "createClient" },
        },
        root,
        "call sites",
      );
      expect(metrics.toolSequence).toEqual(["query_recipe"]);
      expect(metrics.success).toBe(true);
      expect(metrics.resultCount).toBeGreaterThan(0);
    } finally {
      if (prior === undefined) delete process.env.CODEMAP_MCP_TOOLS;
      else process.env.CODEMAP_MCP_TOOLS = prior;
    }
  });

  it("runLiveMcpArm surfaces handler errors on ArmRunMetrics", () => {
    const root = join(import.meta.dir, "../../fixtures/minimal");
    initCodemap(resolveCodemapConfig(root, undefined));
    const prior = process.env.CODEMAP_MCP_TOOLS;
    process.env.CODEMAP_MCP_TOOLS = defaultLiveEvalMcpToolsEnv();
    try {
      const metrics = runLiveMcpArm(
        {
          id: "bad-sql",
          prompt: "bad",
          sql: "SELECT FROM WHERE",
        },
        root,
        "bad",
      );
      expect(metrics.success).toBe(false);
      expect(metrics.error).toBeDefined();
      expect(metrics.error!.length).toBeGreaterThan(0);
    } finally {
      if (prior === undefined) delete process.env.CODEMAP_MCP_TOOLS;
      else process.env.CODEMAP_MCP_TOOLS = prior;
    }
  });
});

describe("compare-live-logs", () => {
  it("compares MCP-on vs MCP-off sample logs", () => {
    const onLog = join(
      import.meta.dir,
      "../../fixtures/agent-eval/sample-cursor-log.json",
    );
    const offLog = join(
      import.meta.dir,
      "../../fixtures/agent-eval/sample-no-mcp-log.json",
    );
    const scenario = compareLogArms(onLog, offLog, "usePermissions");
    expect(scenario.mcpOn.toolCallCount).toBe(1);
    expect(scenario.mcpOff.toolCallCount).toBe(3);
    expect(scenario.delta.toolCallCount).toBe(2);
    const summary = summarizeLogComparison([scenario]);
    expect(summary.mcpOnTotalToolCalls).toBe(1);
    expect(summary.mcpOffTotalToolCalls).toBe(3);
  });

  it("compareLogArms rejects missing log paths", () => {
    expect(() =>
      compareLogArms("/no/such/on.json", "/no/such/off.json"),
    ).toThrow(/MCP-on log not found/);
  });
});

describe("print-comparison-summary", () => {
  it("renders probe comparison markdown", () => {
    const md = formatComparisonMarkdown({
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "probe",
      fixtureRoot: "/tmp",
      runs: 1,
      scenarios: [
        scenario({
          id: "a",
          delta: { toolCallCount: 2, wallMs: 1, estTokens: 50 },
          mcpOff: arm({ toolCallCount: 3, estTokens: 60 }),
        }),
      ],
      summary: {
        mcpOnTotalToolCalls: 1,
        mcpOffTotalToolCalls: 3,
        mcpOnTotalWallMs: 1,
        mcpOffTotalWallMs: 2,
        mcpOnTotalEstTokens: 10,
        mcpOffTotalEstTokens: 60,
        successCount: 1,
      },
    });
    expect(md).toContain("| a |");
    expect(md).toContain("probe (queryRows)");
  });

  it("renders log comparison markdown with wall totals", () => {
    const md = formatComparisonMarkdown({
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "log",
      scenarios: [
        {
          id: "session",
          mcpOn: {
            logPath: "on.json",
            format: "entries-transcript",
            toolSequence: ["query"],
            toolCallCount: 1,
            promptChars: 10,
            outputChars: 5,
            estTokens: 4,
            wallMs: 100,
          },
          mcpOff: {
            logPath: "off.json",
            format: "entries-transcript",
            toolSequence: ["glob", "grep"],
            toolCallCount: 2,
            promptChars: 10,
            outputChars: 5,
            estTokens: 8,
            wallMs: 200,
          },
          delta: { toolCallCount: 1, estTokens: 4, wallMs: 100 },
        },
      ],
      summary: {
        mcpOnTotalToolCalls: 1,
        mcpOffTotalToolCalls: 2,
        mcpOnTotalEstTokens: 4,
        mcpOffTotalEstTokens: 8,
        mcpOnTotalWallMs: 100,
        mcpOffTotalWallMs: 200,
      },
    });
    expect(md).toContain("log exports");
    expect(md).toContain("wall ms");
  });

  it("main rejects malformed comparison JSON", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-bad-json-"));
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, JSON.stringify({ mode: "probe", scenarios: [] }));
    try {
      const result = spawnSync(
        "bun",
        [join(import.meta.dir, "print-comparison-summary.ts"), "--input", bad],
        { encoding: "utf-8", cwd: join(import.meta.dir, "../..") },
      );
      expect(result.status).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("main rejects comparison JSON missing arm metrics", async () => {
    const { spawnSync } = await import("node:child_process");
    const tmp = mkdtempSync(join(tmpdir(), "agent-eval-shallow-json-"));
    const bad = join(tmp, "shallow.json");
    writeFileSync(
      bad,
      JSON.stringify({
        generatedAt: "2026-01-01T00:00:00.000Z",
        mode: "probe",
        scenarios: [{ id: "a" }],
        summary: {
          mcpOnTotalToolCalls: 1,
          mcpOffTotalToolCalls: 2,
          mcpOnTotalEstTokens: 3,
          mcpOffTotalEstTokens: 4,
          successCount: 1,
        },
      }),
    );
    try {
      const result = spawnSync(
        "bun",
        [join(import.meta.dir, "print-comparison-summary.ts"), "--input", bad],
        { encoding: "utf-8", cwd: join(import.meta.dir, "../..") },
      );
      expect(result.status).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("compare-live-logs CLI smoke", () => {
  it("exits 0 comparing sample logs", async () => {
    const { spawnSync } = await import("node:child_process");
    const onLog = join(
      import.meta.dir,
      "../../fixtures/agent-eval/sample-cursor-log.json",
    );
    const offLog = join(
      import.meta.dir,
      "../../fixtures/agent-eval/sample-no-mcp-log.json",
    );
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dir, "compare-live-logs.ts"),
        "--mcp-on",
        onLog,
        "--mcp-off",
        offLog,
      ],
      { encoding: "utf-8", cwd: join(import.meta.dir, "../..") },
    );
    expect(result.status).toBe(0);
  });
});

describe("tool-payload", () => {
  it("resultCountFromToolPayload handles arrays and count envelopes", () => {
    expect(resultCountFromToolPayload([{ a: 1 }, { a: 2 }])).toBe(2);
    expect(resultCountFromToolPayload({ count: 5 })).toBe(5);
    expect(
      resultCountFromToolPayload({
        groups: [{ count: 3 }, { count: 2 }],
      }),
    ).toBe(5);
  });
});
