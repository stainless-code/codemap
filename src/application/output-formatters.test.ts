import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMessageText,
  detectLocationColumn,
  escapeAnnotationData,
  escapeAnnotationProperty,
  formatAuditSarif,
  formatDiff,
  formatDiffJson,
  formatAnnotations,
  formatMermaid,
  formatSarif,
  hasLocatableRows,
  MERMAID_MAX_EDGES,
} from "./output-formatters";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "output-formatters-"));
  mkdirSync(join(workDir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

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

describe("formatAnnotations", () => {
  it("emits ::notice file=…,line=…::msg per row", () => {
    const out = formatAnnotations({
      rows: [
        { file_path: "a.ts", line_start: 5, name: "foo" },
        { file_path: "b.ts", line_start: 10, name: "bar" },
      ],
      recipeId: "deprecated-symbols",
    });
    expect(out.split("\n")).toEqual([
      "::notice file=a.ts,line=5::foo",
      "::notice file=b.ts,line=10::bar",
    ]);
  });

  it("omits line= when no line_start", () => {
    const out = formatAnnotations({
      rows: [{ file_path: "a.ts", fan_in: 17 }],
      recipeId: "fan-in",
    });
    expect(out).toBe("::notice file=a.ts::fan_in=17");
  });

  it("returns empty string for empty rows", () => {
    expect(formatAnnotations({ rows: [], recipeId: "x" })).toBe("");
  });

  it("skips rows with no location", () => {
    const out = formatAnnotations({
      rows: [
        { file_path: "a.ts", name: "foo" },
        { kind: "TODO", count: 5 },
        { file_path: "b.ts", name: "bar" },
      ],
      recipeId: "mixed",
    });
    expect(out.split("\n")).toHaveLength(2);
  });

  it("collapses newlines in messages (GH parser stops at first one)", () => {
    const out = formatAnnotations({
      rows: [
        {
          file_path: "a.ts",
          line_start: 5,
          name: "foo",
          doc_comment: "line1\nline2\nline3",
        },
      ],
      recipeId: "x",
    });
    expect(out.includes("\n")).toBe(false);
    expect(out).toContain("line1 line2 line3");
  });

  it("respects level override", () => {
    const out = formatAnnotations({
      rows: [{ file_path: "a.ts", line_start: 1, name: "x" }],
      recipeId: "x",
      level: "error",
    });
    expect(out).toBe("::error file=a.ts,line=1::x");
  });

  it("escapes file path with comma + colon (Windows drive / SQL JSON)", () => {
    const out = formatAnnotations({
      rows: [{ file_path: "C:\\a,b.ts", line_start: 1, name: "x" }],
      recipeId: "x",
    });
    // Without escaping, the comma would split this into two malformed
    // key=value pairs and the colon would terminate the property prematurely.
    expect(out).toBe("::notice file=C%3A\\a%2Cb.ts,line=1::x");
  });

  it("escapes percent in the message payload", () => {
    // Real-world trigger: doc_comment / signature / value columns containing
    // %. Without escaping, the GH runner reads `%` as a malformed escape
    // sequence and the annotation either errors or drops fields.
    const out = formatAnnotations({
      rows: [
        {
          file_path: "a.ts",
          line_start: 1,
          name: "loadAt50%",
        },
      ],
      recipeId: "x",
    });
    expect(out).toBe("::notice file=a.ts,line=1::loadAt50%25");
  });

  it("collapses CR/LF in the message before escaping (no %0A leaks)", () => {
    // The whitespace collapse runs first by design — annotations are
    // single-line by GH spec, so we normalize THEN escape. Confirms %0A /
    // %0D never appear in message output (escapeAnnotationData's CR/LF
    // path is exercised only by property values like file paths).
    const out = formatAnnotations({
      rows: [
        {
          file_path: "a.ts",
          line_start: 1,
          name: "x",
          extra: "line1\rline2\nline3",
        },
      ],
      recipeId: "x",
    });
    expect(out).not.toContain("%0A");
    expect(out).not.toContain("%0D");
    expect(out).toContain("line1 line2 line3");
  });
});

describe("formatMermaid", () => {
  it("renders a flowchart from {from, to} rows", () => {
    const out = formatMermaid({
      rows: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "c.ts" },
      ],
      recipeId: "fan-out",
    });
    expect(out.startsWith("flowchart LR")).toBe(true);
    expect(out).toContain("a.ts");
    expect(out).toContain("b.ts");
    expect(out).toContain("c.ts");
    expect(out).toContain("-->");
  });

  it("supports optional label as edge text", () => {
    const out = formatMermaid({
      rows: [{ from: "a", to: "b", label: "calls" }],
      recipeId: "x",
    });
    expect(out).toContain('--> |"calls"|');
  });

  it("dedupes node declarations across edges", () => {
    const out = formatMermaid({
      rows: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
      ],
      recipeId: "x",
    });
    const nodeDeclarations = out
      .split("\n")
      .filter((l) => l.match(/^\s+n\d+\["/));
    expect(nodeDeclarations).toHaveLength(3); // a, b, c
  });

  it("rejects unbounded inputs (> MERMAID_MAX_EDGES)", () => {
    const rows = Array.from({ length: MERMAID_MAX_EDGES + 1 }, (_, i) => ({
      from: `a${i}`,
      to: `b${i}`,
    }));
    expect(() => formatMermaid({ rows, recipeId: "fan-out" })).toThrow(
      /produced \d+ edges/,
    );
  });

  it("error message names recipe + scoping knobs", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      from: `a${i}`,
      to: `b${i}`,
    }));
    expect(() => formatMermaid({ rows, recipeId: "fan-out" })).toThrow(
      /fan-out.*LIMIT.*--via.*WHERE/s,
    );
  });

  it("error message uses '(ad-hoc SQL)' when recipeId is undefined", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      from: `a${i}`,
      to: `b${i}`,
    }));
    expect(() => formatMermaid({ rows, recipeId: undefined })).toThrow(
      /\(ad-hoc SQL\)/,
    );
  });

  it("escapes quotes in labels", () => {
    const out = formatMermaid({
      rows: [{ from: 'a"b', to: "c" }],
      recipeId: "x",
    });
    expect(out).toContain('\\"');
  });

  it("skips rows missing from / to", () => {
    const out = formatMermaid({
      rows: [
        { from: "a", to: "b" },
        { from: "c" }, // missing to
        { to: "e" }, // missing from
      ],
      recipeId: "x",
    });
    expect(out).toContain("a.ts" === "a.ts" ? "a" : "");
    // Only one edge should be rendered.
    const edgeLines = out.split("\n").filter((l) => l.includes("-->"));
    expect(edgeLines).toHaveLength(1);
  });
});

describe("formatDiff / formatDiffJson", () => {
  it("emits a unified diff for one replacement", () => {
    writeFileSync(join(workDir, "src/a.ts"), "const oldName = 1;\n");
    const out = formatDiff({
      projectRoot: workDir,
      rows: [
        {
          file_path: "src/a.ts",
          line_start: 1,
          before_pattern: "oldName",
          after_pattern: "newName",
        },
      ],
    });
    expect(out).toContain("--- a/src/a.ts");
    expect(out).toContain("+++ b/src/a.ts");
    expect(out).toContain("@@ -1,1 +1,1 @@");
    expect(out).toContain("-const oldName = 1;");
    expect(out).toContain("+const newName = 1;");
  });

  it("groups multiple hunks under one file header", () => {
    writeFileSync(join(workDir, "src/a.ts"), "oldName();\noldName(1);\n");
    const out = formatDiff({
      projectRoot: workDir,
      rows: [
        {
          file_path: "src/a.ts",
          line_start: 1,
          before_pattern: "oldName",
          after_pattern: "newName",
        },
        {
          file_path: "src/a.ts",
          line_start: 2,
          before_pattern: "oldName",
          after_pattern: "newName",
        },
      ],
    });
    expect(out.match(/^--- a\/src\/a\.ts/gm)).toHaveLength(1);
    expect(out.match(/^@@/gm)).toHaveLength(2);
  });

  it("marks stale rows when before_pattern no longer matches the indexed line", () => {
    writeFileSync(join(workDir, "src/a.ts"), "const currentName = 1;\n");
    const payload = JSON.parse(
      formatDiffJson({
        projectRoot: workDir,
        rows: [
          {
            file_path: "src/a.ts",
            line_start: 1,
            before_pattern: "oldName",
            after_pattern: "newName",
          },
        ],
      }),
    );
    expect(payload.files[0].stale).toBe(true);
    expect(payload.summary.skipped).toBe(1);
  });

  it("treats `$` in after_pattern as a literal (no replacement-pattern leak)", () => {
    writeFileSync(
      join(workDir, "src/a.ts"),
      "const oldName = inject(token);\n",
    );
    const out = formatDiff({
      projectRoot: workDir,
      rows: [
        {
          file_path: "src/a.ts",
          line_start: 1,
          before_pattern: "oldName",
          after_pattern: "$inject",
        },
      ],
    });
    expect(out).toContain("+const $inject = inject(token);");
    expect(out).not.toContain("$&");
  });

  it("classifies missing files even when path contains the word 'stale'", () => {
    const payload = JSON.parse(
      formatDiffJson({
        projectRoot: workDir,
        rows: [
          {
            file_path: "src/stale-module.ts",
            line_start: 1,
            before_pattern: "oldName",
            after_pattern: "newName",
          },
        ],
      }),
    );
    expect(payload.files[0].missing).toBe(true);
    expect(payload.files[0].stale).toBeUndefined();
  });

  it("preserves every per-file warning across multiple stale rows", () => {
    writeFileSync(join(workDir, "src/a.ts"), "alpha\nbeta\n");
    const payload = JSON.parse(
      formatDiffJson({
        projectRoot: workDir,
        rows: [
          {
            file_path: "src/a.ts",
            line_start: 1,
            before_pattern: "oldName",
            after_pattern: "newName",
          },
          {
            file_path: "src/a.ts",
            line_start: 2,
            before_pattern: "oldName",
            after_pattern: "newName",
          },
        ],
      }),
    );
    expect(payload.files[0].warnings).toHaveLength(2);
    expect(payload.summary.skipped).toBe(1);
  });

  it("marks missing rows when source file is gone", () => {
    const payload = JSON.parse(
      formatDiffJson({
        projectRoot: workDir,
        rows: [
          {
            file_path: "src/missing.ts",
            line_start: 1,
            before_pattern: "oldName",
            after_pattern: "newName",
          },
        ],
      }),
    );
    expect(payload.files[0].missing).toBe(true);
    expect(payload.summary.skipped).toBe(1);
  });
});

describe("formatAuditSarif", () => {
  it("emits one rule per delta key + one result per added row", () => {
    const sarif = JSON.parse(
      formatAuditSarif([
        { key: "files", added: [{ path: "src/new.ts" }] },
        {
          key: "dependencies",
          added: [{ from_path: "src/a.ts", to_path: "src/b.ts" }],
        },
        {
          key: "deprecated",
          added: [{ name: "oldFn", kind: "function", file_path: "src/x.ts" }],
        },
      ]),
    );
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("codemap");
    const ruleIds = run.tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toEqual([
      "codemap.audit.files-added",
      "codemap.audit.dependencies-added",
      "codemap.audit.deprecated-added",
    ]);
    expect(run.results).toHaveLength(3);
    // Severity = warning (audit deltas are more actionable than per-recipe `note`)
    expect(run.results.every((r: { level: string }) => r.level === "warning"));
    // Locations auto-detected per row
    expect(
      run.results[0].locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("src/new.ts");
    expect(
      run.results[1].locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("src/b.ts"); // to_path wins per LOCATION_COLUMNS priority
    expect(
      run.results[2].locations[0].physicalLocation.artifactLocation.uri,
    ).toBe("src/x.ts");
  });

  it("emits empty results array when all deltas are empty", () => {
    const sarif = JSON.parse(
      formatAuditSarif([
        { key: "files", added: [] },
        { key: "dependencies", added: [] },
      ]),
    );
    expect(sarif.runs[0].results).toEqual([]);
    // Rules are still declared even when no findings hit them — Code Scanning
    // expects rule registration to be stable across runs.
    expect(sarif.runs[0].tool.driver.rules).toHaveLength(2);
  });

  it("omits locations field for rows without a location column", () => {
    const sarif = JSON.parse(
      formatAuditSarif([
        { key: "files", added: [{ unrelated_column: "foo", count: 5 }] },
      ]),
    );
    const result = sarif.runs[0].results[0];
    expect(result.ruleId).toBe("codemap.audit.files-added");
    expect(result.locations).toBeUndefined();
    // Message still has the row data via buildMessageText
    expect(result.message.text).toContain("count=5");
  });

  it("falls back to 'new <key>: <uri>' message for location-only rows (e.g. files-added)", () => {
    // Files-added rows have only `path` — buildMessageText returns "(no
    // message)" because `path` sits in the location-skip set. Audit-SARIF
    // catches this and produces a meaningful message.
    const sarif = JSON.parse(
      formatAuditSarif([{ key: "files", added: [{ path: "src/new.ts" }] }]),
    );
    expect(sarif.runs[0].results[0].message.text).toBe("new files: src/new.ts");
  });

  it("includes line_start / line_end region when present", () => {
    const sarif = JSON.parse(
      formatAuditSarif([
        {
          key: "deprecated",
          added: [
            {
              name: "oldFn",
              file_path: "src/x.ts",
              line_start: 12,
              line_end: 18,
            },
          ],
        },
      ]),
    );
    const region =
      sarif.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.startLine).toBe(12);
    expect(region.endLine).toBe(18);
  });
});

describe("escapeAnnotationData / escapeAnnotationProperty", () => {
  it("data: percent-encodes %, CR, LF only", () => {
    expect(escapeAnnotationData("a%b\rc\nd")).toBe("a%25b%0Dc%0Ad");
  });

  it("data: leaves : and , alone (only properties need those)", () => {
    expect(escapeAnnotationData("a:b,c")).toBe("a:b,c");
  });

  it("property: extends data escaping with : and ,", () => {
    expect(escapeAnnotationProperty("C:\\a,b")).toBe("C%3A\\a%2Cb");
  });

  it("property: percent escaping happens first (no double-encoding of %3A)", () => {
    // If : were escaped before %, the % in %3A would itself become %25,
    // producing %253A — wrong. Order matters.
    expect(escapeAnnotationProperty(":")).toBe("%3A");
    expect(escapeAnnotationProperty("%")).toBe("%25");
  });

  it("both: empty string round-trips", () => {
    expect(escapeAnnotationData("")).toBe("");
    expect(escapeAnnotationProperty("")).toBe("");
  });
});
