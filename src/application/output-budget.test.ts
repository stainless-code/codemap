import { describe, expect, it } from "bun:test";

import {
  applySourceCharBudget,
  DEFAULT_OUTPUT_CHAR_BUDGET,
} from "./output-budget";

describe("applySourceCharBudget", () => {
  it("returns all items when under budget", () => {
    const items = [{ source: "abc" }, { source: "de" }];
    expect(applySourceCharBudget(items, 10)).toEqual({
      items,
      truncated: false,
    });
  });

  it("truncates when cumulative source exceeds budget", () => {
    const items = [{ source: "aaaa" }, { source: "bbbb" }, { source: "c" }];
    const r = applySourceCharBudget(items, 6);
    expect(r.items).toEqual([{ source: "aaaa" }]);
    expect(r.truncated).toBe(true);
  });

  it("defaults budget constant is 15k", () => {
    expect(DEFAULT_OUTPUT_CHAR_BUDGET).toBe(15_000);
  });
});
