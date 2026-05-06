import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { applyDiffPayload } from "./apply-engine";
import type { ApplyJsonPayload } from "./apply-engine";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "codemap-apply-test-"));
}

function writeSource(root: string, relPath: string, content: string): void {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}

function readSource(root: string, relPath: string): string {
  return readFileSync(join(root, relPath), "utf8");
}

describe("applyDiffPayload", () => {
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

  describe("apply-mode (phase-2 writes)", () => {
    it("writes the transformed content to disk and reports applied=true", () => {
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
        dryRun: false,
      });

      expect(result.mode).toBe("apply");
      expect(result.applied).toBe(true);
      expect(result.files).toEqual([{ file_path: "a.ts", rows_applied: 1 }]);
      expect(result.summary).toEqual({
        files: 1,
        files_modified: 1,
        rows: 1,
        rows_applied: 1,
        conflicts: 0,
        files_with_conflicts: 0,
      });
      expect(readSource(root, "a.ts")).toBe("const bar = 1;\n");
    });

    it("applies multiple rows to the same file in descending line order", () => {
      const root = tmpProject();
      writeSource(
        root,
        "a.ts",
        "const foo = 1;\nconst bar = 2;\nconst baz = 3;\n",
      );

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "ONE",
          },
          {
            file_path: "a.ts",
            line_start: 2,
            before_pattern: "bar",
            after_pattern: "TWO",
          },
          {
            file_path: "a.ts",
            line_start: 3,
            before_pattern: "baz",
            after_pattern: "THREE",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(true);
      expect(result.files[0]?.rows_applied).toBe(3);
      expect(readSource(root, "a.ts")).toBe(
        "const ONE = 1;\nconst TWO = 2;\nconst THREE = 3;\n",
      );
    });

    it("preserves CRLF line endings via raw `\\n` split + join", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\r\nconst bar = 2;\r\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "FOO",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(true);
      expect(readSource(root, "a.ts")).toBe(
        "const FOO = 1;\r\nconst bar = 2;\r\n",
      );
    });

    it("escapes `$` in after_pattern per GetSubstitution (mirrors buildDiffJson)", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const inject = 1;\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "inject",
            after_pattern: "$inject",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(true);
      expect(readSource(root, "a.ts")).toBe("const $inject = 1;\n");
    });

    it("does NOT write any file when conflicts abort phase 2 (Q2 (c))", () => {
      const root = tmpProject();
      writeSource(root, "good.ts", "const foo = 1;\n");
      // bad.ts intentionally missing.
      const goodBefore = readSource(root, "good.ts");

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
        dryRun: false,
      });

      expect(result.mode).toBe("apply");
      expect(result.applied).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      // good.ts must be untouched even though its row would have validated.
      expect(readSource(root, "good.ts")).toBe(goodBefore);
    });

    it("returns applied=false / mode=apply when no rows are applicable", () => {
      const root = tmpProject();

      const result = applyDiffPayload({
        rows: [],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.mode).toBe("apply");
      expect(result.applied).toBe(false);
      expect(result.files).toEqual([]);
      expect(result.summary.rows_applied).toBe(0);
    });

    it("does NOT leave behind any `*.codemap-apply-*.tmp` siblings", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");

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
      });

      const siblings = readdirSync(root);
      expect(siblings.some((s) => s.includes("codemap-apply-"))).toBe(false);
    });
  });

  describe("path-containment guard (F1 — triangulated review 2026-05-06)", () => {
    it("rejects `..`-traversal and never writes outside the project root", () => {
      const root = tmpProject();
      writeSource(root, "in.ts", "const foo = 1;\n");
      // Sibling-of-root file the malicious row would otherwise hit.
      const outsidePath = join(root, "..", "outside.ts");
      writeFileSync(outsidePath, "const foo = 1;\n", "utf8");
      const before = readFileSync(outsidePath, "utf8");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "../outside.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "PWNED",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(false);
      expect(result.conflicts).toEqual([
        {
          file_path: "../outside.ts",
          line_start: 1,
          before_pattern: "foo",
          actual_at_line: "",
          reason: "path escapes project root",
        },
      ]);
      expect(readFileSync(outsidePath, "utf8")).toBe(before);
    });

    it("rejects absolute file_path inputs", () => {
      const root = tmpProject();

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "/etc/passwd",
            line_start: 1,
            before_pattern: "root",
            after_pattern: "X",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(false);
      expect(result.conflicts[0]).toMatchObject({
        reason: "path escapes project root",
      });
    });

    it("rejects nested traversal that resolves outside the root", () => {
      const root = tmpProject();

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "src/../../sibling.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "X",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.conflicts[0]?.reason).toBe("path escapes project root");
    });
  });

  describe("overlap detection (F2 — triangulated review 2026-05-06)", () => {
    it("emits a conflict on duplicate (file_path, line_start) and writes nothing", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");
      writeSource(root, "b.ts", "const foo = 1;\n");
      const aBefore = readSource(root, "a.ts");
      const bBefore = readSource(root, "b.ts");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "a.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "AAA",
          },
          {
            file_path: "b.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "BBB",
          },
          // Duplicate on b.ts:1 — pre-fix triggered a phase-2 throw after a.ts had already renamed.
          {
            file_path: "b.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "CCC",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({
        file_path: "b.ts",
        line_start: 1,
        reason: "duplicate edit on same line",
      });
      // CRITICAL — neither file may have been touched; Q2 (c) holds.
      expect(readSource(root, "a.ts")).toBe(aBefore);
      expect(readSource(root, "b.ts")).toBe(bBefore);
    });
  });

  describe("same-line ambiguity (F3 — documented limitation)", () => {
    it("rewrites only the first occurrence on a line — matches buildDiffJson", () => {
      // Pins current behaviour so a future engine change lands as a deliberate
      // breaking change. See module docstring § Same-line ambiguity.
      const root = tmpProject();
      writeSource(root, "x.ts", "const foo = foo();\n");

      const result = applyDiffPayload({
        rows: [
          {
            file_path: "x.ts",
            line_start: 1,
            before_pattern: "foo",
            after_pattern: "bar",
          },
        ],
        projectRoot: root,
        dryRun: false,
      });

      expect(result.applied).toBe(true);
      expect(result.summary.rows_applied).toBe(1);
      // Declaration renamed; recursive call site untouched.
      expect(readSource(root, "x.ts")).toBe("const bar = foo();\n");
    });
  });

  describe("failure modes", () => {
    it("propagates the writeFileSync error when the file is read-only (chmod 0o444)", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");
      // Chmod the directory to read-only so the temp-file write fails.
      // (The file itself can still be `rename`d to, but writeFileSync of
      // the temp sibling needs write permission on the parent dir.)
      chmodSync(root, 0o555);

      try {
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
        ).toThrow();
      } finally {
        chmodSync(root, 0o755);
      }
    });

    it("is a no-op on disk when dry-run is requested even with valid rows", () => {
      const root = tmpProject();
      writeSource(root, "a.ts", "const foo = 1;\n");
      const before = readSource(root, "a.ts");

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
      expect(result.files).toEqual([{ file_path: "a.ts", rows_applied: 0 }]);
      expect(readSource(root, "a.ts")).toBe(before);
    });
  });
});
