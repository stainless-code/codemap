import type { ToolResult } from "../../src/application/tool-handlers";
import { jsonCharLength } from "./metrics";

/** Row count from a query / query_recipe JSON envelope. */
export function resultCountFromToolPayload(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload !== null && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    if (typeof row.count === "number") return row.count;
    if (Array.isArray(row.groups)) {
      let n = 0;
      for (const group of row.groups) {
        if (group !== null && typeof group === "object") {
          const g = group as { rows?: unknown; count?: unknown };
          if (Array.isArray(g.rows)) n += g.rows.length;
          else if (typeof g.count === "number") n += g.count;
        }
      }
      return n;
    }
  }
  return 0;
}

export function liveMcpPayloadChars(
  tool: string,
  args: unknown,
  result: ToolResult,
): number {
  let chars = Buffer.byteLength(tool, "utf-8") + jsonCharLength(args);
  if (result.ok) {
    if (result.format === "json") {
      chars += jsonCharLength(result.payload);
    } else {
      chars += Buffer.byteLength(result.payload, "utf-8");
    }
  } else {
    chars += Buffer.byteLength(result.error, "utf-8");
  }
  return chars;
}
