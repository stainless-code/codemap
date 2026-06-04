import { describe, expect, it } from "bun:test";

import { parseUnifiedDiffToRows } from "./apply-diff-input";

describe("parseUnifiedDiffToRows", () => {
  it("pairs single-line -/+ hunks", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -2,1 +2,1 @@
-oldName
+newName
`;
    const rows = parseUnifiedDiffToRows(diff);
    expect(rows).toEqual([
      {
        file_path: "src/foo.ts",
        line_start: 2,
        before_pattern: "oldName",
        after_pattern: "newName",
      },
    ]);
  });

  it("pairs consecutive - lines before multiple + lines", () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
-line1
-line2
+newline1
+newline2
`;
    const rows = parseUnifiedDiffToRows(diff);
    expect(rows).toEqual([
      {
        file_path: "src/foo.ts",
        line_start: 1,
        before_pattern: "line1",
        after_pattern: "newline1",
      },
      {
        file_path: "src/foo.ts",
        line_start: 2,
        before_pattern: "line2",
        after_pattern: "newline2",
      },
    ]);
  });
});
