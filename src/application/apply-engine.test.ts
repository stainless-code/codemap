import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyDiffPayload } from "./apply-engine";
import type { ApplyJsonPayload } from "./apply-engine";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "codemap-apply-test-"));
}

function writeSource(root: string, relPath: string, content: string): void {
  writeFileSync(join(root, relPath), content, "utf8");
}

describe("applyDiffPayload — phase 1 + dry-run (Slice 1)", () => {
  describe("happy paths", () => {
    it("returns a clean dry-run envelope for a single-row valid input", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.mode).toBe("dry-run");
      expect(result.applied).toBe(false);
      expect(result.conflicts).toEqual([]);
      expect(result.files).toEqual([{ file_path: "a.ts", rows_applied: 0 }]);
      expect(result.summary).toEqual({
        files: 1,
        files_modified: 0,
        rows: 1,
        rows_applied: 0,
        conflicts: 0,
        files_with_conflicts: 0,
      });
    });

    it("collapses N rows targeting the same file into one ApplyFile entry", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\nconst foo2 = 2;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
          {
            file_path: "a.ts",
            line_start: 2,
            before_pattern: "foo2",
            after_pattern: "bar2",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.files).toEqual([{ file_path: "a.ts", rows_applied: 0 }]);
      expect(result.summary.files).toBe(1);
      expect(result.summary.rows).toBe(2);
    });

    it("sorts files[] by path for deterministic envelope output", () => {
      const root = tmpProject();
      writeSource(root, "z.ts", "const foo = 1;\n");
      writeSource(root, "a.ts", "const foo = 1;\n");
      writeSource(root, "m.ts", "const foo = 1;\n");

      const result = applyDiffPayload({
        rows: ["z.ts", "a.ts", "m.ts"].map((file_path) => ({
          file_path,
          line_start: 1,
          before_pattern: "foo",
          after_pattern: "bar",
        })),
        projectRoot: root,
        dryRun: true,
      });

      expect(result.files.map((f) => f.file_path)).toEqual([
        "a.ts",
        "m.ts",
        "z.ts",
      ]);
    });

    it("matches substrings inside lines (not whole-line exact) — mirrors buildDiffJson", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "  const foo = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts).toEqual([]);
      expect(result.files).toHaveLength(1);
    });
  });

  describe("conflict reporting (Q3 scan-and-collect)", () => {
    it("reports `file missing` when the path doesn't exist", () => {
      const root = tmpProject();

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "ghost.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts).toEqual([
        {
          file_path: "ghost.ts",
          line_start: 1,
          before_pattern: "foo",
          actual_at_line: "",
          reason: "file missing",
        },
      ]);
      expect(result.files).toEqual([]);
      expect(result.summary.conflicts).toBe(1);
      expect(result.summary.files_with_conflicts).toBe(1);
    });

    it("reports `line out of range` when line_start exceeds EOF", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 99,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts[0]).toMatchObject({
        file_path: "a.ts",
        line_start: 99,
        reason: "line out of range",
        actual_at_line: "",
      });
    });

    it("reports `line content drifted` with the actual disk content", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const bar = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "baz",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts[0]).toEqual({
        file_path: "a.ts",
        line_start: 1,
        before_pattern: "foo",
        actual_at_line: "const bar = 1;",
        reason: "line content drifted",
      });
    });

    it("collects ALL conflicts (Q3 scan-and-collect, not fail-fast)", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const a = 1;\n");
      writeSource(root, "b.ts", "const b = 2;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "FOO",
            after_pattern: "X",
          },
          {
            file_path: "b.ts",
            line_start: 1,
            before_pattern: "BAR",
            after_pattern: "Y",
          },
          {
            file_path: "ghost.ts",
            line_start: 1,
            before_pattern: "BAZ",
            after_pattern: "Z",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts).toHaveLength(3);
      expect(result.summary.files_with_conflicts).toBe(3);
      // Q2 (c) — any conflict aborts the run; nothing reported as applicable.
      expect(result.files).toEqual([]);
    });

    it("clears files[] entirely when ANY row conflicts (Q2 (c) all-or-nothing)", () => {
      const root = tmpProject();
      writeSource(root, "good.ts", "const foo = 1;\n");
      // bad.ts intentionally missing.

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "good.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
          {
            file_path: "bad.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.files).toEqual([]);
    });
  });

  describe("row-shape validation", () => {
    it("silently skips rows missing required keys (mirrors buildDiffJson)", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
          { file_path: "a.ts", line_start: 1, before_pattern: "foo" }, // missing after
          {
            file_path: "a.ts",
            line_start: 0,
            before_pattern: "foo",
            after_pattern: "bar",
          }, // line_start not positive
          { line_start: 1, before_pattern: "foo", after_pattern: "bar" }, // missing file_path
        ] as Record<string, unknown>[],
        projectRoot: root,
        dryRun: true,
      });

      expect(result.summary.rows).toBe(1);
      expect(result.conflicts).toEqual([]);
    });

    it("returns the empty envelope for an empty row set", () => {
      const root = tmpProject();

      const result: ApplyJsonPayload = applyDiffPayload({
        rows: [],
        projectRoot: root,
        dryRun: true,
      });

      expect(result).toEqual({
        mode: "dry-run",
        applied: false,
        files: [],
        conflicts: [],
        summary: {
          files: 0,
          files_modified: 0,
          rows: 0,
          rows_applied: 0,
          conflicts: 0,
          files_with_conflicts: 0,
        },
      });
    });
  });

  describe("apply-mode (Slice 1 — guard until Slice 2 lands)", () => {
    it("throws a clear NotImplemented error when dryRun=false has clean phase 1", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

      expect(() =>
        applyDiffPayload({
          rows: [
            {
              file_path: "a.ts",
              line_start: 1,
              before_pattern: "foo",
              after_pattern: "bar",
            },
          ],
          projectRoot: root,
          dryRun: false,
        }),
      ).toThrow(/Slice 2/);
    });

    it("does NOT throw on dryRun=false when conflicts abort phase 2", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "MISSING",
            after_pattern: "X",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.mode).toBe("apply");
      expect(result.applied).toBe(false);
      expect(result.conflicts).toHaveLength(1);
    });

    it("does NOT throw on dryRun=false when no rows are applicable", () => {
      const root = tmpProject();

      const result = applyDiffPayload({
        rows: [],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.mode).toBe("apply");
      expect(result.summary.rows).toBe(0);
    });
  });
});
