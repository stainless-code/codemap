import { describe, expect, it } from "bun:test";

import { extractFileData } from "../parser";

describe("cognitive complexity", () => {
  it("nested if chain: cognitive_complexity > cyclomatic complexity", () => {
    const src = `export function nested(level: number): number {
  if (level > 0) {
    if (level > 1) {
      if (level > 2) {
        return level;
      }
      return 2;
    }
    return 1;
  }
  return 0;
}
`;
    const d = extractFileData("/proj/x.ts", src, "x.ts");
    const sym = d.symbols.find((s) => s.name === "nested");
    expect(sym?.complexity).toBe(4);
    expect(sym?.cognitive_complexity).toBeGreaterThan(sym!.complexity!);
  });

  it("flat if-else-if chain: cognitive ≈ cyclomatic, below nested peer", () => {
    const flatSrc = `export function flat(n: number): number {
  if (n % 2 === 0) return 1;
  else if (n % 3 === 0) return 2;
  else if (n % 5 === 0) return 3;
  return 0;
}
`;
    const nestedSrc = `export function nested(level: number): number {
  if (level > 0) {
    if (level > 1) {
      if (level > 2) {
        return level;
      }
      return 2;
    }
    return 1;
  }
  return 0;
}
`;
    const flat = extractFileData("/proj/x.ts", flatSrc, "x.ts").symbols.find(
      (s) => s.name === "flat",
    );
    const nested = extractFileData(
      "/proj/x.ts",
      nestedSrc,
      "x.ts",
    ).symbols.find((s) => s.name === "nested");
    expect(flat?.complexity).toBe(4);
    expect(nested?.complexity).toBe(4);
    expect(flat?.cognitive_complexity).toBe(3);
    expect(nested?.cognitive_complexity).toBe(6);
    expect(flat!.cognitive_complexity!).toBeLessThan(
      nested!.cognitive_complexity!,
    );
  });

  it("class method: both complexity and cognitive_complexity populated", () => {
    const src = `export class Svc {
  run(level: number): void {
    if (level > 0) {
      if (level > 1) {
        if (level > 2) {
          return;
        }
      }
    }
  }
}
`;
    const d = extractFileData("/proj/x.ts", src, "x.ts");
    const run = d.symbols.find((s) => s.name === "run");
    expect(run?.kind).toBe("method");
    expect(run?.complexity).toBeGreaterThan(1);
    expect(run?.cognitive_complexity).toBeGreaterThan(run!.complexity!);
  });

  it("non-function symbols stay NULL for cognitive_complexity", () => {
    const src = `export interface Row { id: string }\nexport const X = 1;\n`;
    const d = extractFileData("/proj/x.ts", src, "x.ts");
    for (const sym of d.symbols) {
      expect(sym.cognitive_complexity ?? null).toBeNull();
    }
  });
});
