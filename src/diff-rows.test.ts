import { describe, expect, it } from "bun:test";

import { diffRows } from "./diff-rows";

describe("diffRows (multiset)", () => {
  it("reports no diff when baseline equals current", () => {
    expect(diffRows([{ a: 1 }], [{ a: 1 }])).toEqual({
      added: [],
      removed: [],
    });
  });

  it("reports added rows as the new ones not in baseline", () => {
    expect(diffRows([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toEqual({
      added: [{ a: 2 }],
      removed: [],
    });
  });

  it("reports removed rows as those gone from current", () => {
    expect(diffRows([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toEqual({
      added: [],
      removed: [{ a: 2 }],
    });
  });

  it("preserves duplicate-row cardinality (multiset, not set)", () => {
    // Baseline [A, A] vs current [A]: one A is removed, NOT zero.
    expect(diffRows([{ a: 1 }, { a: 1 }], [{ a: 1 }])).toEqual({
      added: [],
      removed: [{ a: 1 }],
    });
  });

  it("matches three-of-three duplicates", () => {
    expect(
      diffRows([{ a: 1 }, { a: 1 }, { a: 1 }], [{ a: 1 }, { a: 1 }]),
    ).toEqual({ added: [], removed: [{ a: 1 }] });
  });

  it("handles per-key independence in mixed multisets", () => {
    expect(
      diffRows(
        [{ k: "x" }, { k: "x" }, { k: "y" }],
        [{ k: "x" }, { k: "y" }, { k: "y" }, { k: "z" }],
      ),
    ).toEqual({
      added: [{ k: "y" }, { k: "z" }],
      removed: [{ k: "x" }],
    });
  });
});
