import { describe, expect, it } from "bun:test";

import {
  detectCommentInputShape,
  renderAuditComment,
  renderSarifComment,
} from "./pr-comment-engine";

describe("detectCommentInputShape", () => {
  it("identifies audit envelopes by the deltas field", () => {
    expect(detectCommentInputShape({ head: {}, deltas: {} })).toBe("audit");
  });

  it("identifies SARIF docs by the runs[] field", () => {
    expect(detectCommentInputShape({ version: "2.1.0", runs: [] })).toBe(
      "sarif",
    );
  });

  it("returns 'empty' for {}", () => {
    expect(detectCommentInputShape({})).toBe("empty");
  });

  it("returns 'unknown' for arbitrary objects", () => {
    expect(detectCommentInputShape({ something: "else" })).toBe("unknown");
  });

  it("returns 'unknown' for non-objects", () => {
    expect(detectCommentInputShape("hello")).toBe("unknown");
    expect(detectCommentInputShape(null)).toBe("unknown");
    expect(detectCommentInputShape(42)).toBe("unknown");
  });
});

describe("renderAuditComment", () => {
  it("emits ✅ when no drift across deltas", () => {
    const r = renderAuditComment({
      head: {},
      deltas: {
        files: { base: { source: "ref", ref: "main" }, added: [], removed: [] },
      },
    });
    expect(r.findings_count).toBe(0);
    expect(r.kind).toBe("audit");
    expect(r.markdown).toContain("✅");
    expect(r.markdown).toContain("No structural drift");
  });

  it("renders summary line + per-delta sections for added rows", () => {
    const r = renderAuditComment({
      head: { sha: "abc12345" },
      deltas: {
        files: {
          base: { source: "ref", ref: "origin/main", sha: "deadbeef0000" },
          added: [{ path: "src/new.ts" }],
          removed: [],
        },
        dependencies: {
          base: { source: "baseline", name: "base-dependencies" },
          added: [
            { from_path: "src/a.ts", to_path: "src/b.ts" },
            { from_path: "src/c.ts", to_path: "src/d.ts" },
          ],
          removed: [],
        },
      },
    });
    expect(r.findings_count).toBe(3);
    // Summary line surfaces non-zero deltas.
    expect(r.markdown).toContain("**files**: +1 / -0");
    expect(r.markdown).toContain("**dependencies**: +2 / -0");
    // Sections per delta.
    expect(r.markdown).toContain("### files");
    expect(r.markdown).toContain("### dependencies");
    // File-added row → location-only formatting.
    expect(r.markdown).toContain("`src/new.ts`");
    // Dependency-added row → from → to formatting.
    expect(r.markdown).toContain("`src/a.ts` → `src/b.ts`");
    // Baseline metadata visible.
    expect(r.markdown).toContain("origin/main");
    expect(r.markdown).toContain("base-dependencies");
  });

  it("collapses lists >50 rows", () => {
    const added: Record<string, unknown>[] = [];
    for (let i = 0; i < 75; i++) added.push({ path: `src/f${i}.ts` });
    const r = renderAuditComment({
      head: {},
      deltas: {
        files: {
          base: { source: "ref", ref: "main", sha: "abc" },
          added,
          removed: [],
        },
      },
    });
    expect(r.findings_count).toBe(75);
    expect(r.markdown).toContain("… and 25 more");
  });

  it("includes removed rows in their own collapsed section", () => {
    const r = renderAuditComment({
      head: {},
      deltas: {
        deprecated: {
          base: { source: "ref", ref: "main", sha: "abc" },
          added: [],
          removed: [{ name: "oldFn", kind: "function", file_path: "src/x.ts" }],
        },
      },
    });
    expect(r.markdown).toContain("➖ 1 removed");
    expect(r.markdown).toContain("`oldFn`");
  });
});

describe("renderSarifComment", () => {
  it("emits ✅ when no findings", () => {
    const r = renderSarifComment({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "codemap", rules: [] } },
          results: [],
        },
      ],
    });
    expect(r.findings_count).toBe(0);
    expect(r.markdown).toContain("✅");
  });

  it("groups results by ruleId in summary + sections", () => {
    const r = renderSarifComment({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "codemap",
              rules: [
                {
                  id: "codemap.deprecated-symbols",
                  name: "deprecated-symbols",
                },
                { id: "codemap.untested-and-dead", name: "untested-and-dead" },
              ],
            },
          },
          results: [
            {
              ruleId: "codemap.deprecated-symbols",
              message: { text: "oldFn is deprecated" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/a.ts" },
                    region: { startLine: 12 },
                  },
                },
              ],
            },
            {
              ruleId: "codemap.deprecated-symbols",
              message: { text: "anotherFn is deprecated" },
            },
            {
              ruleId: "codemap.untested-and-dead",
              message: { text: "deadFn never called" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/b.ts" },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(r.findings_count).toBe(3);
    // Summary line.
    expect(r.markdown).toContain("**codemap.deprecated-symbols**: 2");
    expect(r.markdown).toContain("**codemap.untested-and-dead**: 1");
    // Per-rule sections.
    expect(r.markdown).toContain("### codemap.deprecated-symbols (2)");
    expect(r.markdown).toContain("### codemap.untested-and-dead (1)");
    // Result lines with location.
    expect(r.markdown).toContain("`src/a.ts:12`");
    expect(r.markdown).toContain("`src/b.ts`");
    // Result without location still renders the message.
    expect(r.markdown).toContain("anotherFn is deprecated");
  });

  it("collapses results lists >50 entries per rule", () => {
    const results = [];
    for (let i = 0; i < 75; i++) {
      results.push({
        ruleId: "codemap.bulk",
        message: { text: `finding ${i}` },
      });
    }
    const r = renderSarifComment({
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "codemap",
              rules: [{ id: "codemap.bulk", name: "bulk" }],
            },
          },
          results,
        },
      ],
    });
    expect(r.findings_count).toBe(75);
    expect(r.markdown).toContain("… and 25 more");
  });
});
