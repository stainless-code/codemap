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

describe("multi-declarator arrow scopes", () => {
  it("keeps distinct scope_local_id for sibling arrow declarators", () => {
    const src = `
const a = () => { console.log('a'); }, b = () => { console.log('b'); };
`;
    const data = extractFileData("/proj/scopes.ts", src, "scopes.ts");
    const markers = data.runtimeMarkers.filter((m) => m.kind === "console");
    const scopeIds = new Set(markers.map((m) => m.scope_local_id));
    expect(scopeIds.size).toBe(2);
  });
});

describe("referencesExtractor", () => {
  it("suppresses read on uninitialized let and marks destructuring writes", () => {
    const src = `
let x;
const { a } = obj;
`;
    const data = extractFileData("/proj/refs.ts", src, "refs.ts");
    const xRefs = data.references.filter((r) => r.name === "x");
    expect(xRefs.some((r) => r.is_write === 1)).toBe(false);
    const aRefs = data.references.filter((r) => r.name === "a");
    expect(aRefs.some((r) => r.is_write === 1)).toBe(true);
  });
});

describe("module side effects", () => {
  it("marks top-level new and update expressions", () => {
    const src = `
new Registry();
let n = 0;
n++;
`;
    const data = extractFileData("/proj/side.ts", src, "side.ts");
    expect(data.hasSideEffects).toBe(1);
  });
});

describe("testsExtractor", () => {
  it("records test.each curried calls", () => {
    const src = `
import { test } from "bun:test";
test.each([[1]])("case %p", () => {});
`;
    const data = extractFileData("/proj/t.ts", src, "t.ts");
    expect(data.testSuites).toHaveLength(1);
    expect(data.testSuites[0]?.name).toBe("case %p");
    expect(data.testSuites[0]?.kind).toBe("test");
  });
});

describe("runtimeMarkers process.env", () => {
  it("records bare and bracket env reads", () => {
    const src = `
const env = process.env;
const key = process.env["NODE_ENV"];
`;
    const data = extractFileData("/proj/env.ts", src, "env.ts");
    const kinds = data.runtimeMarkers
      .filter((m) => m.kind === "process-env")
      .map((m) => m.detail);
    expect(kinds).toContain(null);
    expect(kinds).toContain("NODE_ENV");
  });
});
