import { describe, expect, it } from "bun:test";

import {
  buildMessageText,
  detectLocationColumn,
  formatSarif,
  hasLocatableRows,
} from "./output-formatters";

describe("detectLocationColumn", () => {
  it("prefers file_path over path/to_path/from_path", () => {
    expect(
      detectLocationColumn({
        file_path: "a.ts",
        path: "x.ts",
        to_path: "y.ts",
      }),
    ).toBe("file_path");
  });

  it("falls through to path", () => {
    expect(detectLocationColumn({ path: "a.ts" })).toBe("path");
  });

  it("falls through to to_path", () => {
    expect(detectLocationColumn({ to_path: "a.ts" })).toBe("to_path");
  });

  it("falls through to from_path", () => {
    expect(detectLocationColumn({ from_path: "a.ts" })).toBe("from_path");
  });

  it("returns null when no location column", () => {
    expect(detectLocationColumn({ kind: "TODO", count: 5 })).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(detectLocationColumn({ file_path: "" })).toBeNull();
  });
});

describe("hasLocatableRows", () => {
  it("false on empty rows", () => {
    expect(hasLocatableRows([])).toBe(false);
  });

  it("true when any row has a location", () => {
    expect(hasLocatableRows([{ kind: "TODO" }, { file_path: "a.ts" }])).toBe(
      true,
    );
  });

  it("false when no row has a location", () => {
    expect(hasLocatableRows([{ kind: "TODO" }, { count: 5 }])).toBe(false);
  });
});

describe("buildMessageText", () => {
  it("leads with name when present", () => {
    expect(
      buildMessageText({
        name: "foo",
        file_path: "a.ts",
        line_start: 5,
      }),
    ).toBe("foo");
  });

  it("includes kind in parens when present", () => {
    expect(
      buildMessageText({ name: "foo", kind: "function", file_path: "a.ts" }),
    ).toBe("foo (function)");
  });

  it("appends extras as key=value", () => {
    expect(
      buildMessageText({
        name: "foo",
        kind: "function",
        file_path: "a.ts",
        signature: "foo(): void",
      }),
    ).toBe("foo (function): signature=foo(): void");
  });

  it("skips location columns + line_start/line_end", () => {
    expect(
      buildMessageText({
        file_path: "a.ts",
        path: "x.ts",
        to_path: "y.ts",
        from_path: "z.ts",
        line_start: 1,
        line_end: 5,
        extra: "v",
      }),
    ).toBe("extra=v");
  });

  it("falls back to (no message) when nothing usable", () => {
    expect(buildMessageText({ file_path: "a.ts" })).toBe("(no message)");
  });

  it("skips null / undefined extras", () => {
    expect(
      buildMessageText({
        name: "foo",
        file_path: "a.ts",
        nullCol: null,
        undefCol: undefined,
        ok: "v",
      }),
    ).toBe("foo: ok=v");
  });
});

describe("formatSarif", () => {
  it("emits a valid SARIF doc with results: [] for empty rows", () => {
    const out = formatSarif({
      rows: [],
      recipeId: "fan-in",
      recipeDescription: "Fan-in description",
    });
    const doc = JSON.parse(out);
    expect(doc.version).toBe("2.1.0");
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0].tool.driver.name).toBe("codemap");
    expect(doc.runs[0].tool.driver.rules[0].id).toBe("codemap.fan-in");
    expect(doc.runs[0].results).toEqual([]);
  });

  it("uses codemap.adhoc rule id when no recipeId", () => {
    const out = formatSarif({ rows: [], recipeId: undefined });
    const doc = JSON.parse(out);
    expect(doc.runs[0].tool.driver.rules[0].id).toBe("codemap.adhoc");
    expect(doc.runs[0].tool.driver.rules[0].name).toBe("adhoc");
  });

  it("emits one result per row with file_path location", () => {
    const out = formatSarif({
      rows: [
        { file_path: "a.ts", line_start: 5, name: "foo" },
        { file_path: "b.ts", line_start: 10, name: "bar" },
      ],
      recipeId: "deprecated-symbols",
    });
    const doc = JSON.parse(out);
    expect(doc.runs[0].results).toHaveLength(2);
    expect(doc.runs[0].results[0]).toMatchObject({
      ruleId: "codemap.deprecated-symbols",
      level: "note",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "a.ts" },
            region: { startLine: 5 },
          },
        },
      ],
    });
  });

  it("includes endLine when line_end is present", () => {
    const out = formatSarif({
      rows: [{ file_path: "a.ts", line_start: 5, line_end: 10 }],
      recipeId: undefined,
    });
    const doc = JSON.parse(out);
    expect(doc.runs[0].results[0].locations[0].physicalLocation.region).toEqual(
      {
        startLine: 5,
        endLine: 10,
      },
    );
  });

  it("omits region when no line columns are present", () => {
    const out = formatSarif({
      rows: [{ file_path: "a.ts", fan_in: 17 }],
      recipeId: "fan-in",
    });
    const doc = JSON.parse(out);
    expect(doc.runs[0].results[0].locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: "a.ts" },
    });
  });

  it("skips rows with no location column", () => {
    const out = formatSarif({
      rows: [
        { file_path: "a.ts", name: "foo" },
        { kind: "TODO", count: 5 }, // no location → skipped
        { file_path: "b.ts", name: "bar" },
      ],
      recipeId: "mixed",
    });
    const doc = JSON.parse(out);
    expect(doc.runs[0].results).toHaveLength(2);
  });

  it("attaches recipeBody as fullDescription", () => {
    const out = formatSarif({
      rows: [],
      recipeId: "x",
      recipeDescription: "short",
      recipeBody: "## Long form body",
    });
    const doc = JSON.parse(out);
    expect(doc.runs[0].tool.driver.rules[0].fullDescription).toEqual({
      text: "## Long form body",
    });
  });
});
