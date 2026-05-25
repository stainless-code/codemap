import { describe, expect, it } from "bun:test";

import {
  CHANGED_PATH_DELIM,
  joinChangedPaths,
  parseAffectedRest,
} from "./cmd-affected";

describe("joinChangedPaths", () => {
  it("joins unique trimmed paths with RS delimiter", () => {
    expect(
      joinChangedPaths([
        "src/a.ts",
        "./src/b.ts",
        "src/a.ts",
        "",
        "  src/c.ts  ",
      ]),
    ).toBe(["src/a.ts", "src/b.ts", "src/c.ts"].join(CHANGED_PATH_DELIM));
  });
});

describe("parseAffectedRest", () => {
  it("returns help on --help / -h", () => {
    expect(parseAffectedRest(["affected", "--help"]).kind).toBe("help");
    expect(parseAffectedRest(["affected", "-h"]).kind).toBe("help");
  });

  it("parses defaults with no path source flags", () => {
    expect(parseAffectedRest(["affected"])).toEqual({
      kind: "run",
      stdin: false,
      changedSince: undefined,
      positionalPaths: [],
      testGlob: undefined,
      maxDepth: undefined,
      json: false,
    });
  });

  it("parses --stdin, --json, --changed-since, and --params", () => {
    expect(
      parseAffectedRest([
        "affected",
        "--stdin",
        "--json",
        "--changed-since",
        "origin/main",
        "--params",
        "test_glob=*.test.ts,max_depth=12",
      ]),
    ).toEqual({
      kind: "run",
      stdin: true,
      changedSince: "origin/main",
      positionalPaths: [],
      testGlob: "*.test.ts",
      maxDepth: 12,
      json: true,
    });
  });

  it("parses positional paths", () => {
    expect(
      parseAffectedRest(["affected", "./src/a.ts", "src/b.ts", "--json"]),
    ).toEqual({
      kind: "run",
      stdin: false,
      changedSince: undefined,
      positionalPaths: ["src/a.ts", "src/b.ts"],
      testGlob: undefined,
      maxDepth: undefined,
      json: true,
    });
  });

  it("rejects positional paths combined with --stdin", () => {
    const r = parseAffectedRest(["affected", "--stdin", "src/a.ts"]);
    expect(r.kind).toBe("error");
  });

  it("rejects changed_files in --params", () => {
    const r = parseAffectedRest([
      "affected",
      "--params",
      "changed_files=src/a.ts",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/changed_files/);
  });
});
