import { describe, expect, it } from "vitest";

import { labyrinth } from "../lib/complexity-fixture";

describe("smoke", () => {
  it.skip("skipped example", () => {
    expect(labyrinth(0)).toBe(0);
  });

  it.only("focused example", () => {
    expect(labyrinth(1)).toBeGreaterThanOrEqual(0);
  });

  it.todo("todo example");

  it("passing", () => {
    expect(1).toBe(1);
  });
});

describe("nested suite", () => {
  it("inner case", () => {
    expect(true).toBe(true);
  });
});
