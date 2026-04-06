import { describe, expect, it } from "bun:test";

import { extractFileData } from "./parser";

describe("extractFileData", () => {
  describe("TS / JS extension variants (oxc lang + symbols)", () => {
    it("parses .mts as TypeScript", () => {
      const src = `export const answer = 42;\n`;
      const d = extractFileData("/proj/pkg.mts", src, "pkg.mts");
      expect(d.symbols.some((s) => s.name === "answer")).toBe(true);
    });

    it("parses .cts as TypeScript", () => {
      const src = `export const answer = 42;\n`;
      const d = extractFileData("/proj/pkg.cts", src, "pkg.cts");
      expect(d.symbols.some((s) => s.name === "answer")).toBe(true);
    });

    it("parses .mjs as JavaScript", () => {
      const src = `export const answer = 42;\n`;
      const d = extractFileData("/proj/pkg.mjs", src, "pkg.mjs");
      expect(d.symbols.some((s) => s.name === "answer")).toBe(true);
    });

    it("parses .cjs as JavaScript", () => {
      const src = `const answer = 42;\nmodule.exports = { answer };\n`;
      const d = extractFileData("/proj/pkg.cjs", src, "pkg.cjs");
      expect(d.symbols.some((s) => s.name === "answer")).toBe(true);
    });

    it("does not treat .mts as JSX for component detection", () => {
      const src = `export function NotAComponent() { return null; }\n`;
      const d = extractFileData("/proj/x.mts", src, "x.mts");
      expect(d.components.some((c) => c.name === "NotAComponent")).toBe(false);
    });

    it("treats .tsx as JSX for PascalCase function components", () => {
      const src = `export function Button() { return null; }\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "Button")).toBe(true);
    });
  });
});
