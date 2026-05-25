import { describe, expect, it } from "bun:test";

import { parseShowSnippetRest } from "./show-snippet-args";

describe("parseShowSnippetRest", () => {
  it("errors when --query has no value", () => {
    const r = parseShowSnippetRest(["show", "--query"], {
      verb: "show",
      allowPrintSql: true,
    });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--query");
  });

  it("parses --with-fts for snippet", () => {
    const r = parseShowSnippetRest(
      ["snippet", "--query", "name:foo", "--with-fts", "--json"],
      { verb: "snippet", allowPrintSql: false },
    );
    expect(r).toEqual({
      kind: "run",
      name: undefined,
      kindFilter: undefined,
      inPath: undefined,
      query: "name:foo",
      withFts: true,
      printSql: false,
      json: true,
    });
  });
});
