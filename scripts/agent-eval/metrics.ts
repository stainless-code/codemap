/** Chars / 4 token estimate (benchmark § Agent eval harness). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export function jsonCharLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf-8");
}
