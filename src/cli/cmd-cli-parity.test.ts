import { describe, expect, it } from "bun:test";

import {
  parseExploreRest,
  parseNodeRest,
  parseTraceRest,
} from "./cmd-composers";
import { parseContextRest } from "./cmd-context";
import { parseQueryBatchRest } from "./cmd-query-batch";
import { parseFileRest, parseSchemaRest } from "./cmd-resource";

describe("parseContextRest — include-snippets", () => {
  it("parses --include-snippets", () => {
    expect(parseContextRest(["context", "--include-snippets"])).toEqual({
      kind: "run",
      compact: false,
      intent: null,
      includeSnippets: true,
    });
  });
});

describe("parseTraceRest", () => {
  it("requires --from and --to", () => {
    expect(parseTraceRest(["trace"]).kind).toBe("error");
  });

  it("parses full args", () => {
    expect(
      parseTraceRest([
        "trace",
        "--from",
        "foo",
        "--to",
        "bar",
        "--max-depth",
        "2",
        "--via",
        "calls",
        "--budget-chars",
        "1000",
        "--compact",
      ]),
    ).toEqual({
      kind: "run",
      from: "foo",
      to: "bar",
      maxDepth: 2,
      via: "calls",
      budgetChars: 1000,
      json: true,
      compact: true,
    });
  });
});

describe("parseExploreRest", () => {
  it("requires at least one name", () => {
    expect(parseExploreRest(["explore"]).kind).toBe("error");
  });

  it("parses positional names", () => {
    expect(parseExploreRest(["explore", "foo", "bar", "--depth", "1"])).toEqual(
      {
        kind: "run",
        names: ["foo", "bar"],
        depth: 1,
        kindFilter: undefined,
        budgetChars: undefined,
        json: true,
        compact: false,
      },
    );
  });
});

describe("parseNodeRest", () => {
  it("parses include-snippets", () => {
    expect(
      parseNodeRest(["node", "foo", "--in", "src/a.ts", "--include-snippets"]),
    ).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: undefined,
      inPath: "src/a.ts",
      includeSnippets: true,
      budgetChars: undefined,
      json: true,
      compact: false,
    });
  });
});

describe("parseFileRest", () => {
  it("parses path", () => {
    expect(parseFileRest(["file", "src/db.ts", "--compact"])).toEqual({
      kind: "run",
      path: "src/db.ts",
      compact: true,
    });
  });
});

describe("parseSchemaRest", () => {
  it("parses no args", () => {
    expect(parseSchemaRest(["schema"])).toEqual({
      kind: "run",
      compact: false,
    });
  });
});

describe("parseQueryBatchRest", () => {
  it("requires stdin or file", () => {
    expect(parseQueryBatchRest(["query", "batch"]).kind).toBe("error");
  });

  it("rejects --stdin and --file together", () => {
    expect(
      parseQueryBatchRest(["query", "batch", "--stdin", "--file", "x.json"])
        .kind,
    ).toBe("error");
  });
});
