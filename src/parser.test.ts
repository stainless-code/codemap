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
      const src = `export function Button() { return <button>click</button>; }\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "Button")).toBe(true);
    });
  });

  describe("signatures — generics and return types", () => {
    it("includes return type annotation on functions", () => {
      const src = `export function greet(name: string): string { return name; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "greet")?.signature;
      expect(sig).toBe("greet(name): string");
    });

    it("includes generic type params on functions", () => {
      const src = `export function identity<T>(val: T): T { return val; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "identity")?.signature;
      expect(sig).toBe("identity<T>(val): T");
    });

    it("includes constrained generics", () => {
      const src = `export function first<T extends string>(items: T[]): T { return items[0]; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "first")?.signature;
      expect(sig).toBe("first<T extends string>(items): T");
    });

    it("includes return type on arrow functions", () => {
      const src = `export const add = (a: number, b: number): number => a + b;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "add")?.signature;
      expect(sig).toBe("add(a, b): number");
    });

    it("includes generics on arrow functions", () => {
      const src = `export const wrap = <T>(val: T): T[] => [val];\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "wrap")?.signature;
      expect(sig).toBe("wrap<T>(val): T[]");
    });

    it("includes generics on type aliases", () => {
      const src = `export type Result<T, E = Error> = { ok: T } | { err: E };\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "Result")?.signature;
      expect(sig).toBe("type Result<T, E = Error>");
    });

    it("includes generics and extends on interfaces", () => {
      const src = `export interface Repo<T> extends Iterable<T> { get(id: string): T; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "Repo")?.signature;
      expect(sig).toBe("interface Repo<T> extends Iterable<T>");
    });

    it("includes generics, extends, and implements on classes", () => {
      const src = `export class Store<T> extends Base<T> implements IStore<T> {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "Store")?.signature;
      expect(sig).toBe("class Store<T> extends Base<T> implements IStore<T>");
    });

    it("handles union return types", () => {
      const src = `export function parse(s: string): number | null { return null; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "parse")?.signature;
      expect(sig).toBe("parse(s): number | null");
    });

    it("handles Promise return type", () => {
      const src = `export async function load(): Promise<void> {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "load")?.signature;
      expect(sig).toBe("load(): Promise<void>");
    });

    it("omits return type when unannotated", () => {
      const src = `export function run() { return 1; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sig = d.symbols.find((s) => s.name === "run")?.signature;
      expect(sig).toBe("run()");
    });
  });

  describe("enum members extraction", () => {
    it("extracts string enum members with values", () => {
      const src = `export enum Status { Active = "active", Inactive = "inactive" }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const sym = d.symbols.find((s) => s.name === "Status");
      expect(sym?.kind).toBe("enum");
      const members = JSON.parse(sym!.members!);
      expect(members).toEqual([
        { name: "Active", value: "active" },
        { name: "Inactive", value: "inactive" },
      ]);
    });

    it("extracts numeric enum members", () => {
      const src = `export enum Dir { Up = 0, Down = 1, Left = 2 }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const members = JSON.parse(
        d.symbols.find((s) => s.name === "Dir")!.members!,
      );
      expect(members).toEqual([
        { name: "Up", value: 0 },
        { name: "Down", value: 1 },
        { name: "Left", value: 2 },
      ]);
    });

    it("extracts implicit-value enum members (no initializer)", () => {
      const src = `export enum Color { Red, Green, Blue }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const members = JSON.parse(
        d.symbols.find((s) => s.name === "Color")!.members!,
      );
      expect(members).toEqual([
        { name: "Red" },
        { name: "Green" },
        { name: "Blue" },
      ]);
    });

    it("returns null members for non-enum symbols", () => {
      const src = `export function foo(): void {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "foo")?.members).toBeNull();
    });
  });

  describe("component detection heuristic", () => {
    it("detects components that return JSX", () => {
      const src = `export function Card() { return <div>card</div>; }\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "Card")).toBe(true);
    });

    it("detects arrow components that return JSX", () => {
      const src = `export const Card = () => <div>card</div>;\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "Card")).toBe(true);
    });

    it("detects components that use hooks", () => {
      const src = `export function Timer() { useEffect(() => {}); return null; }\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "Timer")).toBe(true);
    });

    it("rejects PascalCase functions without JSX or hooks", () => {
      const src = [
        `export function FormatCurrency(n: number): string { return "$"+n; }`,
        `export function ValidateEmail(e: string): boolean { return e.includes("@"); }`,
      ].join("\n");
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components).toHaveLength(0);
    });

    it("rejects PascalCase functions that return null without hooks", () => {
      const src = `export function EmptyPlaceholder() { return null; }\n`;
      const d = extractFileData("/proj/x.tsx", src, "x.tsx");
      expect(d.components.some((c) => c.name === "EmptyPlaceholder")).toBe(
        false,
      );
    });
  });
});
