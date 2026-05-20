import { describe, expect, it } from "bun:test";

import { extractFileData } from "../parser";

describe("jsxExtractor fragment bounds", () => {
  it("uses openingFragment token columns, not the full fragment span", () => {
    const src = `export function Card() {
  return (
    <>
      <article>hi</article>
    </>
  );
}
`;
    const data = extractFileData("/proj/Card.tsx", src, "Card.tsx");
    const fragment = data.jsxElements.find((e) => e.is_fragment === 1);
    expect(fragment).toBeDefined();
    expect(fragment).toMatchObject({
      component_name: "",
      is_fragment: 1,
      column_start: 4,
      column_end: 6,
      line_start: 3,
      line_end: 5,
    });
  });
});
