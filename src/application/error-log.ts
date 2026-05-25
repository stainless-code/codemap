import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Append-only per-file index failure log inside `<state-dir>/`. */
export const ERROR_LOG_NAME = "errors.log";

export function errorLogPath(stateDir: string): string {
  return join(stateDir, ERROR_LOG_NAME);
}

/** One TSV line: ISO timestamp, file path, reason (tabs flattened). */
export function appendIndexError(
  stateDir: string,
  filePath: string,
  reason: string,
): void {
  mkdirSync(stateDir, { recursive: true });
  const safeReason = reason.replace(/\t/g, " ").replace(/\n/g, " ");
  const line = `${new Date().toISOString()}\t${filePath}\t${safeReason}\n`;
  appendFileSync(errorLogPath(stateDir), line, "utf-8");
}
