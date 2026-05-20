import { describe, expect, it } from "bun:test";

import { extractFileData } from "../parser";
import { parseJsDocTags } from "./behavioral";

describe("parseJsDocTags", () => {
  it("parses bare @returns, @throws, and @tag lines", () => {
    expect(parseJsDocTags("@returns\n@throws\n@deprecated")).toEqual([
      {
        tag: "@returns",
        name: null,
        type_text: null,
        description: null,
      },
      {
        tag: "@throws",
        name: null,
        type_text: null,
        description: null,
      },
      {
        tag: "@deprecated",
        name: null,
        type_text: null,
        description: null,
      },
    ]);
  });

  it("parses typed tags with descriptions", () => {
    expect(
      parseJsDocTags("@returns {Promise<void>} resolved\n@throws {Error} boom"),
    ).toEqual([
      {
        tag: "@returns",
        name: null,
        type_text: "Promise<void>",
        description: "resolved",
      },
      {
        tag: "@throws",
        name: null,
        type_text: "Error",
        description: "boom",
      },
    ]);
  });
});

describe("behavioralExtractor try/catch", () => {
  it("does not set catch_rethrows when throw is inside nested function", () => {
    const src = `
export function innerArrowCatch() {
  try {
    void 0;
  } catch (e) {
    const relay = () => {
      throw e;
    };
    relay();
  }
}
`;
    const data = extractFileData("/proj/x.ts", src, "x.ts");
    expect(data.tryCatchRows).toHaveLength(1);
    expect(data.tryCatchRows[0]?.catch_rethrows).toBe(0);
  });

  it("sets catch_rethrows when catch body directly rethrows the param", () => {
    const src = `
export function directRethrow(): never {
  try {
    void 0;
  } catch (err) {
    throw err;
  }
}
`;
    const data = extractFileData("/proj/x.ts", src, "x.ts");
    expect(data.tryCatchRows).toHaveLength(1);
    expect(data.tryCatchRows[0]?.catch_rethrows).toBe(1);
  });
});
