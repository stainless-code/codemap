import { describe, expect, it } from "bun:test";

import { parseSync } from "oxc-parser";

import { extractHeritageFromSource } from "./heritage";
import { buildLineMap } from "./offsets";

describe("heritage extractor", () => {
  it("records multi-base interface extends with generics", () => {
    const src = `
interface Both extends Animal, Map<string, Pet> {}
`;
    const result = parseSync("x.ts", src);
    const lineMap = buildLineMap(src);
    const rows = extractHeritageFromSource("x.ts", result.program, lineMap);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.base_simple_name).sort()).toEqual([
      "Animal",
      "Map",
    ]);
    expect(rows.find((r) => r.base_simple_name === "Map")?.type_args).toBe(
      "string, Pet",
    );
  });

  it("records class superClass and implements", () => {
    const src = `
class Dog extends Mammal implements Pet {}
`;
    const result = parseSync("x.ts", src);
    const lineMap = buildLineMap(src);
    const rows = extractHeritageFromSource("x.ts", result.program, lineMap);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.relation, r.base_simple_name])).toEqual(
      expect.arrayContaining([
        ["extends", "Mammal"],
        ["implements", "Pet"],
      ]),
    );
  });

  it("marks qualified extends as qualified-unresolved", () => {
    const src = `
namespace pkg {
  export interface Base {}
}
interface Child extends pkg.Base {}
`;
    const result = parseSync("x.ts", src);
    const lineMap = buildLineMap(src);
    const rows = extractHeritageFromSource("x.ts", result.program, lineMap);
    const edge = rows.find((r) => r.child_name === "Child");
    expect(edge?.base_qualified_name).toBe("pkg.Base");
    expect(edge?.resolution_kind).toBe("qualified-unresolved");
  });
});
