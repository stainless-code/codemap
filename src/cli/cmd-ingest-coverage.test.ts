import { describe, expect, it } from "bun:test";

import { parseIngestCoverageRest } from "./cmd-ingest-coverage";

describe("parseIngestCoverageRest", () => {
  it("requires the ingest-coverage subcommand position", () => {
    expect(() => parseIngestCoverageRest(["query"])).toThrow();
  });

  it("returns help on --help / -h", () => {
    expect(parseIngestCoverageRest(["ingest-coverage", "--help"])).toEqual({
      kind: "help",
    });
    expect(parseIngestCoverageRest(["ingest-coverage", "-h"])).toEqual({
      kind: "help",
    });
  });

  it("parses a single path with default --json=false", () => {
    expect(
      parseIngestCoverageRest([
        "ingest-coverage",
        "coverage/coverage-final.json",
      ]),
    ).toEqual({
      kind: "run",
      path: "coverage/coverage-final.json",
      json: false,
    });
  });

  it("parses --json", () => {
    expect(
      parseIngestCoverageRest(["ingest-coverage", "coverage", "--json"]),
    ).toEqual({ kind: "run", path: "coverage", json: true });
  });

  it("rejects missing path", () => {
    const r = parseIngestCoverageRest(["ingest-coverage"]);
    expect(r.kind).toBe("error");
  });

  it("rejects unknown options", () => {
    const r = parseIngestCoverageRest([
      "ingest-coverage",
      "x",
      "--source",
      "lcov",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/unknown option.*--source/);
    }
  });

  it("rejects multiple paths", () => {
    const r = parseIngestCoverageRest(["ingest-coverage", "a.json", "b.json"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/unexpected extra argument/);
    }
  });
});
