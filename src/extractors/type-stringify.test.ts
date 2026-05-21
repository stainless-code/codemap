import { describe, expect, it } from "bun:test";

import { stringifyTypeNode } from "./type-stringify";

describe("stringifyTypeNode TSTypeQuery", () => {
  it("stringifies qualified typeof names", () => {
    const node = {
      type: "TSTypeQuery",
      exprName: {
        type: "TSQualifiedName",
        left: { type: "Identifier", name: "A" },
        right: { type: "Identifier", name: "B" },
      },
    };
    expect(stringifyTypeNode(node)).toBe("typeof A.B");
  });
});
