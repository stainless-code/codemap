import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { parseAgentLog, parseAgentLogFile } from "./parse-agent-log";

const sampleLog = join(
  import.meta.dir,
  "../../fixtures/agent-eval/sample-cursor-log.json",
);

describe("parse-agent-log", () => {
  it("parses entries-transcript JSON", () => {
    const parsed = parseAgentLogFile(sampleLog);
    expect(parsed.format).toBe("entries-transcript");
    expect(parsed.toolSequence).toEqual(["query"]);
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.promptChars).toBeGreaterThan(0);
    expect(parsed.estTokens).toBeGreaterThan(0);
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

  it("parses line-oriented tool logs", () => {
    const raw = `USER: find createClient call sites
TOOL: Grep
TOOL: Read
TOOL: query
ASSISTANT: found 3 call sites`;
    const parsed = parseAgentLog(raw);
    expect(parsed.format).toBe("line-log");
    expect(parsed.toolSequence).toEqual(["Grep", "Read", "query"]);
    expect(parsed.toolCallCount).toBe(3);
  });
});
