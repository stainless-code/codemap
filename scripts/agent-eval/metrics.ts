/** Chars / 4 token estimate per agent-eval-harness plan L.4. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function jsonCharLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}
