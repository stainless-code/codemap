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
});
