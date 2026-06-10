import { describe, expect, it } from "bun:test";

import { extractFileData } from "../parser";
import { canonicalizeBody, hashFunctionBody } from "./body-hash";

describe("canonicalizeBody", () => {
  it("normalizes identifiers to $id", () => {
    const a = canonicalizeBody({
      type: "BlockStatement",
      body: [
        {
          type: "ReturnStatement",
          argument: { type: "Identifier", name: "foo" },
        },
      ],
    });
    const b = canonicalizeBody({
      type: "BlockStatement",
      body: [
        {
          type: "ReturnStatement",
          argument: { type: "Identifier", name: "bar" },
        },
      ],
    });
    expect(a).toBe(b);
    expect(a).toContain("$id");
  });

  it("normalizes literal values to kind only", () => {
    const a = canonicalizeBody({
      type: "BlockStatement",
      body: [
        {
          type: "ReturnStatement",
          argument: { type: "Literal", value: "foo" },
        },
      ],
    });
    const b = canonicalizeBody({
      type: "BlockStatement",
      body: [
        {
          type: "ReturnStatement",
          argument: { type: "Literal", value: "bar" },
        },
      ],
    });
    expect(a).toBe(b);
    expect(a).toContain("Literal:string");
  });
});

describe("body_hash extraction", () => {
  it("isomorphic FunctionDeclaration bodies share body_hash", () => {
    const aSrc = `export function alpha(x: number): number {
  if (x > 0) {
    return x;
  }
  return 0;
}
`;
    const bSrc = `export function beta(y: number): number {
  if (y > 0) {
    return y;
  }
  return 0;
}
`;
    const a = extractFileData("/proj/a.ts", aSrc, "bench/duplicate-a.ts");
    const b = extractFileData("/proj/b.ts", bSrc, "bench/duplicate-b.ts");
    const aSym = a.symbols.find((s) => s.name === "alpha");
    const bSym = b.symbols.find((s) => s.name === "beta");
    expect(aSym?.body_hash).toBeTruthy();
    expect(aSym?.body_hash).toBe(bSym?.body_hash);
  });

  it("different control flow yields different body_hash", () => {
    const aSrc = `export function plain(n: number): number {
  return n;
}
`;
    const bSrc = `export function branch(n: number): number {
  if (n > 0) return n;
  return 0;
}
`;
    const a = extractFileData("/proj/a.ts", aSrc, "a.ts").symbols.find(
      (s) => s.name === "plain",
    );
    const b = extractFileData("/proj/b.ts", bSrc, "b.ts").symbols.find(
      (s) => s.name === "branch",
    );
    expect(a?.body_hash).toBeTruthy();
    expect(b?.body_hash).toBeTruthy();
    expect(a?.body_hash).not.toBe(b?.body_hash);
  });

  it("skips hash when body_line_count < 2", () => {
    const src = `export function tiny() { return 1; }`;
    const sym = extractFileData("/proj/x.ts", src, "x.ts").symbols.find(
      (s) => s.name === "tiny",
    );
    expect(sym?.body_line_count).toBe(1);
    expect(sym?.body_hash ?? null).toBeNull();
  });

  it("leaves body_hash null on non-function symbols", () => {
    const src = `export const x = 1;`;
    const sym = extractFileData("/proj/x.ts", src, "x.ts").symbols.find(
      (s) => s.name === "x",
    );
    expect(sym?.body_hash ?? null).toBeNull();
  });

  it("hashFunctionBody returns null for trivial span", () => {
    expect(
      hashFunctionBody({ type: "BlockStatement", body: [] }, 1),
    ).toBeNull();
  });

  it("isomorphic named arrow bodies share body_hash", () => {
    const aSrc = `export const arrowA = (x: number): number => {
  if (x > 0) {
    return x;
  }
  return 0;
};
`;
    const bSrc = `export const arrowB = (y: number): number => {
  if (y > 0) {
    return y;
  }
  return 0;
};
`;
    const a = extractFileData("/proj/a.ts", aSrc, "a.ts").symbols.find(
      (s) => s.name === "arrowA",
    );
    const b = extractFileData("/proj/b.ts", bSrc, "b.ts").symbols.find(
      (s) => s.name === "arrowB",
    );
    expect(a?.body_hash).toBeTruthy();
    expect(a?.body_hash).toBe(b?.body_hash);
  });

  it("same template shape with different quasi text shares body_hash", () => {
    const aSrc = `export function a(): string {
  return \`hello \${x}\`;
}
`;
    const bSrc = `export function b(): string {
  return \`world \${y}\`;
}
`;
    const a = extractFileData("/proj/a.ts", aSrc, "a.ts").symbols.find(
      (s) => s.name === "a",
    );
    const b = extractFileData("/proj/b.ts", bSrc, "b.ts").symbols.find(
      (s) => s.name === "b",
    );
    expect(a?.body_hash).toBe(b?.body_hash);
  });

  it("isomorphic class getters share body_hash", () => {
    const aSrc = `class A {
  get val(): number {
    if (this.x > 0) return this.x;
    return 0;
  }
}
`;
    const bSrc = `class B {
  get val(): number {
    if (this.y > 0) return this.y;
    return 0;
  }
}
`;
    const a = extractFileData("/proj/a.ts", aSrc, "a.ts").symbols.find(
      (s) => s.name === "val" && s.kind === "getter",
    );
    const b = extractFileData("/proj/b.ts", bSrc, "b.ts").symbols.find(
      (s) => s.name === "val" && s.kind === "getter",
    );
    expect(a?.body_hash).toBeTruthy();
    expect(a?.body_hash).toBe(b?.body_hash);
  });

  it("isomorphic class methods share body_hash", () => {
    const aSrc = `class A {
  run(x: number): number {
    if (x > 0) return x;
    return 0;
  }
}
`;
    const bSrc = `class B {
  go(y: number): number {
    if (y > 0) return y;
    return 0;
  }
}
`;
    const a = extractFileData("/proj/a.ts", aSrc, "a.ts").symbols.find(
      (s) => s.name === "run",
    );
    const b = extractFileData("/proj/b.ts", bSrc, "b.ts").symbols.find(
      (s) => s.name === "go",
    );
    expect(a?.body_hash).toBeTruthy();
    expect(a?.body_hash).toBe(b?.body_hash);
  });
});
