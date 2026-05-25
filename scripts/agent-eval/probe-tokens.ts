import { estimateTokens, jsonCharLength } from "./metrics";

/** Probe-mode token budget: prompt + payload chars, then chars/4 (plan L.4). */
export function estimateProbeTokens(
  prompt: string,
  payloadChars: number,
): number {
  return estimateTokens(Buffer.byteLength(prompt, "utf-8") + payloadChars);
}

export function mcpOnPayloadChars(sql: string, rows: unknown[]): number {
  return Buffer.byteLength(sql, "utf-8") + jsonCharLength(rows);
}

/** MCP-off reads full file bodies; grep hits are a small JSON tail. */
export function mcpOffPayloadChars(
  bytesRead: number,
  results: unknown[],
): number {
  return bytesRead + jsonCharLength(results);
}
