import { describe, expect, test } from "bun:test";

import {
  parseFilesParallel,
  parseParseWorkerCountOverride,
} from "./worker-pool";

describe("parseParseWorkerCountOverride", () => {
  test("accepts valid decimal integers", () => {
    expect(parseParseWorkerCountOverride("2")).toBe(2);
    expect(parseParseWorkerCountOverride("32")).toBe(32);
    expect(parseParseWorkerCountOverride("999")).toBe(32);
  });

  test("rejects malformed or non-positive values", () => {
    expect(parseParseWorkerCountOverride("2abc")).toBeNull();
    expect(parseParseWorkerCountOverride("1.5")).toBeNull();
    expect(parseParseWorkerCountOverride("0")).toBeNull();
    expect(parseParseWorkerCountOverride("-1")).toBeNull();
    expect(parseParseWorkerCountOverride(" 2")).toBeNull();
  });

  test("treats unset or empty as no override", () => {
    expect(parseParseWorkerCountOverride(undefined)).toBeNull();
    expect(parseParseWorkerCountOverride("")).toBeNull();
  });
});

describe("parseFilesParallel", () => {
  test("resolves immediately for an empty file list", async () => {
    await expect(parseFilesParallel([])).resolves.toEqual([]);
  });
});
