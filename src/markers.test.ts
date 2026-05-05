import { describe, expect, it } from "bun:test";

import { extractMarkers, extractSuppressions } from "./markers";

describe("extractMarkers", () => {
  it("finds TODO with line number and content", () => {
    const src = "// line1\n// line2\n// TODO: fix this\n";
    const m = extractMarkers(src, "f.ts");
    expect(m).toHaveLength(1);
    expect(m[0].file_path).toBe("f.ts");
    expect(m[0].kind).toBe("TODO");
    expect(m[0].line_number).toBe(3);
    expect(m[0].content).toBe("fix this");
  });

  it("captures FIXME, HACK, and NOTE", () => {
    const src = "// FIXME: x\n// HACK: y\n// NOTE: z\n";
    const m = extractMarkers(src, "f.ts");
    expect(m.map((x) => x.kind)).toEqual(["FIXME", "HACK", "NOTE"]);
    expect(m.map((x) => x.content)).toEqual(["x", "y", "z"]);
  });

  it("finds multiple markers in one file", () => {
    const src = "TODO: a\nTODO: b\n";
    const m = extractMarkers(src, "f.ts");
    expect(m).toHaveLength(2);
    expect(m[0].line_number).toBe(1);
    expect(m[1].line_number).toBe(2);
  });

  it("trims trailing content after marker", () => {
    const src = "// TODO:   spaced   \n";
    const m = extractMarkers(src, "f.ts");
    expect(m[0].content).toBe("spaced");
  });

  it("detects node_modules in path segments", () => {
    const src = "// TODO: in vendor\n";
    const m = extractMarkers(src, "node_modules/pkg/x.ts");
    expect(m[0].file_path).toBe("node_modules/pkg/x.ts");
  });

  it("returns empty when no markers", () => {
    expect(extractMarkers("const x = 1;", "f.ts")).toEqual([]);
  });
});

describe("extractSuppressions", () => {
  it("recognizes // codemap-ignore-next-line and points at the next line", () => {
    const src = [
      "const a = 1;", // line 1
      "// codemap-ignore-next-line untested-and-dead", // line 2
      "export function legacy() {}", // line 3 — suppressed
    ].join("\n");
    const s = extractSuppressions(src, "f.ts");
    expect(s).toEqual([
      { file_path: "f.ts", line_number: 3, recipe_id: "untested-and-dead" },
    ]);
  });

  it("recognizes // codemap-ignore-file and encodes scope as line_number = 0", () => {
    const src =
      "// codemap-ignore-file boundary-violations\nimport x from './y';\n";
    const s = extractSuppressions(src, "f.ts");
    expect(s).toEqual([
      { file_path: "f.ts", line_number: 0, recipe_id: "boundary-violations" },
    ]);
  });

  it("supports multiple suppressions across one file", () => {
    const src = [
      "// codemap-ignore-file deprecated-symbols",
      "// line 2",
      "// codemap-ignore-next-line unimported-exports",
      "export const x = 1;",
    ].join("\n");
    const s = extractSuppressions(src, "f.ts");
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({
      file_path: "f.ts",
      line_number: 0,
      recipe_id: "deprecated-symbols",
    });
    expect(s[1]).toEqual({
      file_path: "f.ts",
      line_number: 4,
      recipe_id: "unimported-exports",
    });
  });

  it("recognises hash, dash, and HTML/block comment leaders (markdown / yaml / sql)", () => {
    expect(
      extractSuppressions(
        "# codemap-ignore-file deprecated-symbols\n",
        "a.yml",
      ),
    ).toEqual([
      { file_path: "a.yml", line_number: 0, recipe_id: "deprecated-symbols" },
    ]);
    expect(
      extractSuppressions("-- codemap-ignore-file boundaries\n", "schema.sql"),
    ).toEqual([
      { file_path: "schema.sql", line_number: 0, recipe_id: "boundaries" },
    ]);
    expect(
      extractSuppressions(
        "<!-- codemap-ignore-file unused-type-members -->\n",
        "doc.md",
      ),
    ).toEqual([
      { file_path: "doc.md", line_number: 0, recipe_id: "unused-type-members" },
    ]);
    expect(
      extractSuppressions("/* codemap-ignore-file fan-in */\n", "f.css"),
    ).toEqual([{ file_path: "f.css", line_number: 0, recipe_id: "fan-in" }]);
  });

  it("returns empty when no suppression markers", () => {
    expect(
      extractSuppressions("const x = 1;\n// regular TODO: y\n", "f.ts"),
    ).toEqual([]);
  });

  it("ignores prose mentions inside multi-line doc comments (no false positives)", () => {
    // ` * ` continuation lines aren't leaders, so directive in prose is ignored.
    const src = [
      "/**",
      " * Document mentions codemap-ignore-file boundaries in prose;",
      " * NOT a real suppression because the line leader is `* `, not `//`.",
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(extractSuppressions(src, "f.ts")).toEqual([]);
  });
});
