import { describe, expect, it } from "bun:test";

import {
  filterRowsByChangedFiles,
  getFilesChangedSince,
  PATH_COLUMNS,
} from "./git-changed";

describe("filterRowsByChangedFiles", () => {
  const changed = new Set(["src/a.ts", "src/b.tsx"]);

  it("keeps rows where file_path matches", () => {
    const out = filterRowsByChangedFiles(
      [
        { name: "Foo", file_path: "src/a.ts" },
        { name: "Bar", file_path: "src/c.ts" },
      ],
      changed,
    );
    expect(out).toEqual([{ name: "Foo", file_path: "src/a.ts" }]);
  });

  it("keeps rows where path matches", () => {
    const out = filterRowsByChangedFiles(
      [
        { path: "src/a.ts", line_count: 10 },
        { path: "src/c.ts", line_count: 20 },
      ],
      changed,
    );
    expect(out).toEqual([{ path: "src/a.ts", line_count: 10 }]);
  });

  it("keeps rows where from_path OR to_path matches (dependencies-shape)", () => {
    const out = filterRowsByChangedFiles(
      [
        { from_path: "src/a.ts", to_path: "src/x.ts" },
        { from_path: "src/y.ts", to_path: "src/b.tsx" },
        { from_path: "src/y.ts", to_path: "src/z.ts" },
      ],
      changed,
    );
    expect(out).toEqual([
      { from_path: "src/a.ts", to_path: "src/x.ts" },
      { from_path: "src/y.ts", to_path: "src/b.tsx" },
    ]);
  });

  it("passes through rows with no recognised path column", () => {
    const out = filterRowsByChangedFiles(
      [{ count: 42 }, { kind: "TODO", n: 7 }],
      changed,
    );
    expect(out).toHaveLength(2);
  });

  it("handles non-object rows by passing them through", () => {
    const out = filterRowsByChangedFiles([1, "x", null], changed);
    expect(out).toEqual([1, "x", null]);
  });

  it("PATH_COLUMNS covers the schema's path-bearing columns", () => {
    expect(PATH_COLUMNS).toContain("path");
    expect(PATH_COLUMNS).toContain("file_path");
    expect(PATH_COLUMNS).toContain("from_path");
    expect(PATH_COLUMNS).toContain("to_path");
    expect(PATH_COLUMNS).toContain("resolved_path");
  });
});

describe("getFilesChangedSince", () => {
  const root = process.cwd();

  it("returns ok set for HEAD (empty diff against itself)", () => {
    const r = getFilesChangedSince("HEAD", root);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files).toBeInstanceOf(Set);
  });

  it("rejects empty ref", () => {
    const r = getFilesChangedSince("", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("non-empty ref");
  });

  it("rejects unresolvable ref with a clean error", () => {
    const r = getFilesChangedSince("not-a-real-ref-xyz123", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cannot resolve");
  });
});
