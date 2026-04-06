import { describe, expect, it } from "bun:test";

import { extractMarkers } from "./markers";

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
