import { readFileSync } from "node:fs";

import { estimateTokens, jsonCharLength } from "./metrics";

export interface ParsedAgentLog {
  format: string;
  toolSequence: string[];
  toolCallCount: number;
  promptChars: number;
  outputChars: number;
  estTokens: number;
  wallMs?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toolNameFromCall(call: JsonRecord): string | undefined {
  if (typeof call.tool === "string") return call.tool;
  if (typeof call.name === "string") return call.name;
  const fn = call.function;
  if (isRecord(fn) && typeof fn.name === "string") return fn.name;
  return undefined;
}

function collectFromEntries(entries: unknown[]): {
  tools: string[];
  promptChars: number;
  outputChars: number;
  wallMs?: number;
} {
  const tools: string[] = [];
  let promptChars = 0;
  let outputChars = 0;
  let wallMs: number | undefined;

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const kind = entry.kind ?? entry.type;
    if (kind === "tool_call" || kind === "tool_use") {
      const name = toolNameFromCall(entry);
      if (name) tools.push(normalizeToolName(name));
    }
    if (entry.role === "assistant" && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (!isRecord(call)) continue;
        const name = toolNameFromCall(call);
        if (name) tools.push(normalizeToolName(name));
      }
    }
    if (entry.role === "assistant" && Array.isArray(entry.toolCalls)) {
      for (const call of entry.toolCalls) {
        if (!isRecord(call)) continue;
        const name = toolNameFromCall(call);
        if (name) tools.push(normalizeToolName(name));
      }
    }
    const text =
      typeof entry.text === "string"
        ? entry.text
        : typeof entry.content === "string"
          ? entry.content
          : undefined;
    if (text !== undefined) {
      if (entry.role === "user" || kind === "user") {
        promptChars += Buffer.byteLength(text, "utf-8");
      } else {
        outputChars += Buffer.byteLength(text, "utf-8");
      }
    }
    if (typeof entry.wallMs === "number") wallMs = entry.wallMs;
    if (typeof entry.durationMs === "number") wallMs = entry.durationMs;
  }

  return { tools, promptChars, outputChars, wallMs };
}

function normalizeToolName(name: string): string {
  return name.replace(/^mcp[_-]?/i, "").replace(/^codemap[_-]?/i, "");
}

function parseJsonLog(data: unknown): ParsedAgentLog {
  if (Array.isArray(data)) {
    const { tools, promptChars, outputChars, wallMs } =
      collectFromEntries(data);
    const estChars = promptChars + outputChars + jsonCharLength(tools);
    return {
      format: "array-transcript",
      toolSequence: tools,
      toolCallCount: tools.length,
      promptChars,
      outputChars,
      estTokens: estimateTokens(estChars),
      wallMs,
    };
  }
  if (!isRecord(data)) {
    throw new Error("agent log: expected JSON object or array");
  }
  if (Array.isArray(data.entries)) {
    const { tools, promptChars, outputChars, wallMs } = collectFromEntries(
      data.entries,
    );
    const estChars = promptChars + outputChars + jsonCharLength(tools);
    return {
      format: "entries-transcript",
      toolSequence: tools,
      toolCallCount: tools.length,
      promptChars,
      outputChars,
      estTokens: estimateTokens(estChars),
      wallMs,
    };
  }
  if (Array.isArray(data.messages)) {
    const { tools, promptChars, outputChars, wallMs } = collectFromEntries(
      data.messages,
    );
    const estChars = promptChars + outputChars + jsonCharLength(tools);
    return {
      format: "messages-transcript",
      toolSequence: tools,
      toolCallCount: tools.length,
      promptChars,
      outputChars,
      estTokens: estimateTokens(estChars),
      wallMs,
    };
  }
  throw new Error(
    "agent log: unsupported JSON shape (expected entries, messages, or array)",
  );
}

function parseLineLog(raw: string): ParsedAgentLog {
  const tools: string[] = [];
  let promptChars = 0;
  let outputChars = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const toolMatch = trimmed.match(
      /^(?:tool[_\s-]?use|tool_call|TOOL)\s*[:=]\s*(\S+)/i,
    );
    if (toolMatch?.[1]) {
      tools.push(normalizeToolName(toolMatch[1]));
      continue;
    }
    if (trimmed.startsWith("USER:")) {
      promptChars += Buffer.byteLength(trimmed.slice(5), "utf-8");
    } else if (trimmed.startsWith("ASSISTANT:")) {
      outputChars += Buffer.byteLength(trimmed.slice(10), "utf-8");
    }
  }
  const estChars = promptChars + outputChars + jsonCharLength(tools);
  return {
    format: "line-log",
    toolSequence: tools,
    toolCallCount: tools.length,
    promptChars,
    outputChars,
    estTokens: estimateTokens(estChars),
  };
}

export function parseAgentLog(raw: string): ParsedAgentLog {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonLog(JSON.parse(raw) as unknown);
  }
  return parseLineLog(raw);
}

export function parseAgentLogFile(path: string): ParsedAgentLog {
  return parseAgentLog(readFileSync(path, "utf-8"));
}
