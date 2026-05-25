/** Default per-file parse timeout floor (ms). */
export const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

/** Hard cap on per-file parse timeout (ms). */
export const MAX_PARSE_TIMEOUT_MS = 30_000;

/** +1 ms per this many bytes between floor and cap. */
export const PARSE_TIMEOUT_BYTES_PER_MS = 50_000;

const PARSE_TIMEOUT_ENV_RE = /^\d+$/;

export function parseParseTimeoutMsOverride(
  env: string | undefined,
): number | null {
  if (env === undefined || env === "") return null;
  if (!PARSE_TIMEOUT_ENV_RE.test(env)) return null;
  const parsed = Number(env);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Per-file parse budget: `CODEMAP_PARSE_TIMEOUT_MS` when set, else
 * 10s + size scaling capped at 30s.
 */
export function computeParseTimeoutMs(
  fileSizeBytes: number,
  env: string | undefined = process.env.CODEMAP_PARSE_TIMEOUT_MS,
): number {
  const override = parseParseTimeoutMsOverride(env);
  if (override !== null) return override;
  const scaled =
    DEFAULT_PARSE_TIMEOUT_MS +
    Math.floor(Math.max(0, fileSizeBytes) / PARSE_TIMEOUT_BYTES_PER_MS);
  return Math.min(MAX_PARSE_TIMEOUT_MS, scaled);
}

export class ParseTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`parse timed out after ${timeoutMs}ms`);
    this.name = "ParseTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
