import { createHash } from "node:crypto";

/**
 * Stable content fingerprint for incremental indexing.
 * Same algorithm on Bun and Node (unlike Bun.hash).
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
