import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PARSE_TIMEOUT_MS,
  MAX_PARSE_TIMEOUT_MS,
  computeParseTimeoutMs,
  parseParseTimeoutMsOverride,
} from "./parse-timeout";

describe("parseParseTimeoutMsOverride", () => {
  test("accepts positive integers", () => {
    expect(parseParseTimeoutMsOverride("5000")).toBe(5000);
  });

  test("rejects malformed values", () => {
    expect(parseParseTimeoutMsOverride("0")).toBeNull();
    expect(parseParseTimeoutMsOverride("abc")).toBeNull();
  });
});

describe("computeParseTimeoutMs", () => {
  test("uses env override when set", () => {
    expect(computeParseTimeoutMs(1_000_000, "15000")).toBe(15_000);
  });

  test("scales with file size up to cap", () => {
    expect(computeParseTimeoutMs(0, undefined)).toBe(DEFAULT_PARSE_TIMEOUT_MS);
    expect(computeParseTimeoutMs(5_000_000, undefined)).toBe(10_000 + 100);
    expect(computeParseTimeoutMs(2_000_000_000, undefined)).toBe(
      MAX_PARSE_TIMEOUT_MS,
    );
  });
});
