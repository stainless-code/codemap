import { describe, expect, it } from "bun:test";

import { classifyIntent, parseContextRest } from "./cmd-context";

describe("parseContextRest", () => {
  it("returns help for --help / -h", () => {
    expect(parseContextRest(["context", "--help"]).kind).toBe("help");
    expect(parseContextRest(["context", "-h"]).kind).toBe("help");
  });

  it("parses no args as default run", () => {
    expect(parseContextRest(["context"])).toEqual({
      kind: "run",
      compact: false,
      intent: null,
    });
  });

  it("parses --compact", () => {
    expect(parseContextRest(["context", "--compact"])).toEqual({
      kind: "run",
      compact: true,
      intent: null,
    });
  });

  it("parses --for with quoted intent", () => {
    expect(parseContextRest(["context", "--for", "refactor auth"])).toEqual({
      kind: "run",
      compact: false,
      intent: "refactor auth",
    });
  });

  it("parses --compact + --for in any order", () => {
    expect(
      parseContextRest(["context", "--for", "fix bug", "--compact"]),
    ).toEqual({ kind: "run", compact: true, intent: "fix bug" });
  });

  it("errors when --for has no value", () => {
    const r = parseContextRest(["context", "--for"]);
    expect(r.kind).toBe("error");
  });

  it("errors when --for value looks like a flag", () => {
    const r = parseContextRest(["context", "--for", "--compact"]);
    expect(r.kind).toBe("error");
  });

  it("rejects unknown options", () => {
    expect(parseContextRest(["context", "--nope"]).kind).toBe("error");
  });
});

describe("classifyIntent", () => {
  it("classifies refactor intent", () => {
    const r = classifyIntent("refactor the auth module");
    expect(r.classified_as).toBe("refactor");
    expect(r.matched_recipes).toContain("fan-in");
  });

  it("classifies debug intent", () => {
    expect(classifyIntent("fix this crash").classified_as).toBe("debug");
    expect(classifyIntent("debug regression").classified_as).toBe("debug");
  });

  it("classifies test intent", () => {
    expect(classifyIntent("add coverage for parser").classified_as).toBe(
      "test",
    );
  });

  it("classifies feature intent", () => {
    expect(classifyIntent("implement dark mode").classified_as).toBe("feature");
  });

  it("classifies explore intent", () => {
    expect(
      classifyIntent("give me an overview of the repo").classified_as,
    ).toBe("explore");
  });

  it("falls back to other for unmatched intent", () => {
    expect(classifyIntent("xyz").classified_as).toBe("other");
  });
});
