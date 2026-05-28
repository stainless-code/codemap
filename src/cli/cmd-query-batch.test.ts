import { describe, expect, it } from "bun:test";

import { parseQueryBatchInput, parseQueryBatchRest } from "./cmd-query-batch";

describe("parseQueryBatchRest", () => {
  it("parses --stdin with batch flags", () => {
    expect(
      parseQueryBatchRest([
        "query",
        "batch",
        "--stdin",
        "--summary",
        "--changed-since",
        "HEAD",
        "--group-by",
        "directory",
        "--compact",
      ]),
    ).toEqual({
      kind: "run",
      stdin: true,
      filePath: undefined,
      summary: true,
      changedSince: "HEAD",
      groupBy: "directory",
      compact: true,
    });
  });

  it("parses --no-summary", () => {
    expect(
      parseQueryBatchRest(["query", "batch", "--stdin", "--no-summary"]),
    ).toEqual({
      kind: "run",
      stdin: true,
      filePath: undefined,
      summary: false,
      changedSince: undefined,
      groupBy: undefined,
      compact: false,
    });
  });
});

describe("parseQueryBatchInput", () => {
  it("rejects invalid top-level summary type", () => {
    const r = parseQueryBatchInput(
      { statements: ["SELECT 1"], summary: "yes" },
      {},
    );
    expect("error" in r).toBe(true);
  });

  it("rejects invalid group_by in JSON body", () => {
    const r = parseQueryBatchInput(
      { statements: ["SELECT 1"], group_by: "bogus" },
      {},
    );
    expect("error" in r).toBe(true);
  });

  it("accepts statements array shorthand", () => {
    const r = parseQueryBatchInput(["SELECT 1"], { summary: true });
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.statements).toEqual(["SELECT 1"]);
      expect(r.summary).toBe(true);
    }
  });

  it("honors CLI --no-summary default", () => {
    const r = parseQueryBatchInput(["SELECT 1"], { summary: false });
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.summary).toBe(false);
    }
  });
});
