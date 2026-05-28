import { stdin as input } from "node:process";

/** Read one JSON value from stdin (used by `codemap query batch --stdin`). */
export async function readJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    throw new Error("codemap query batch: stdin was empty.");
  }
  return JSON.parse(text) as unknown;
}
