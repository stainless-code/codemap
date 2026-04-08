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

  describe("JSDoc extraction", () => {
    it("attaches single-line JSDoc to function", () => {
      const src = `/** Formats a value. */\nexport function fmt(v: string): string { return v; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "fmt")?.doc_comment).toBe(
        "Formats a value.",
      );
    });

    it("attaches multi-line JSDoc with @deprecated", () => {
      const src = `/**\n * Old helper.\n * @deprecated Use newHelper instead.\n */\nexport function oldHelper(): void {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const doc = d.symbols.find((s) => s.name === "oldHelper")?.doc_comment;
      expect(doc).toContain("Old helper.");
      expect(doc).toContain("@deprecated");
    });

    it("does not attach orphan comment across code boundary", () => {
      const src = `/** Orphan */\nconst x = 1;\nexport function foo(): void {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "foo")?.doc_comment).toBeNull();
    });

    it("attaches JSDoc to interface", () => {
      const src = `/** Session data. */\nexport interface Session { id: string; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "Session")?.doc_comment).toBe(
        "Session data.",
      );
    });

    it("returns null when no JSDoc present", () => {
      const src = `export const x = 42;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "x")?.doc_comment).toBeNull();
    });
  });

  describe("type members extraction", () => {
    it("extracts interface property members", () => {
      const src = `export interface User { id: string; name: string; age?: number; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.typeMembers).toHaveLength(3);
      expect(d.typeMembers[0]).toMatchObject({
        symbol_name: "User",
        name: "id",
        type: "string",
        is_optional: 0,
      });
      expect(d.typeMembers[2]).toMatchObject({
        name: "age",
        type: "number",
        is_optional: 1,
      });
    });

    it("extracts interface method signatures", () => {
      const src = `export interface Store { get(key: string): number; set(key: string, val: number): void; }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.typeMembers).toHaveLength(2);
      expect(d.typeMembers[0]).toMatchObject({
        symbol_name: "Store",
        name: "get",
        type: "(key) => number",
      });
      expect(d.typeMembers[1]).toMatchObject({
        name: "set",
        type: "(key, val) => void",
      });
    });

    it("extracts type alias object literal members", () => {
      const src = `export type Config = { host: string; port?: number; };\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.typeMembers).toHaveLength(2);
      expect(d.typeMembers[0]).toMatchObject({
        symbol_name: "Config",
        name: "host",
        type: "string",
      });
      expect(d.typeMembers[1]).toMatchObject({
        name: "port",
        is_optional: 1,
      });
    });

    it("does not extract type members from union types", () => {
      const src = `export type Status = "ok" | "error";\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.typeMembers).toHaveLength(0);
    });

    it("does not extract type members from functions", () => {
      const src = `export function foo(): void {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.typeMembers).toHaveLength(0);
    });
  });

  describe("const literal value extraction", () => {
    it("extracts string literal", () => {
      const src = `export const URL = "https://api.example.com";\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "URL")?.value).toBe(
        "https://api.example.com",
      );
    });

    it("extracts number literal", () => {
      const src = `export const MAX = 42;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "MAX")?.value).toBe("42");
    });

    it("extracts boolean literal", () => {
      const src = `export const DEBUG = true;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "DEBUG")?.value).toBe("true");
    });

    it("extracts negative number", () => {
      const src = `export const OFFSET = -1;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "OFFSET")?.value).toBe("-1");
    });

    it("extracts null literal", () => {
      const src = `export const EMPTY = null;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "EMPTY")?.value).toBe("null");
    });

    it("extracts value through as const", () => {
      const src = `export const MODE = "production" as const;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "MODE")?.value).toBe(
        "production",
      );
    });

    it("extracts simple template literal without expressions", () => {
      const src = `export const GREETING = \`hello world\`;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "GREETING")?.value).toBe(
        "hello world",
      );
    });

    it("returns null for non-literal values", () => {
      const src = `export const arr = [1, 2];\nexport const fn = () => {};\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "arr")?.value).toBeNull();
      expect(d.symbols.find((s) => s.name === "fn")?.value).toBeNull();
    });
  });

  describe("symbol nesting and scope", () => {
    it("top-level symbols have null parent_name", () => {
      const src = `export function foo(): void {}\nexport const bar = 42;\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "foo")?.parent_name).toBeNull();
      expect(d.symbols.find((s) => s.name === "bar")?.parent_name).toBeNull();
    });

    it("nested function declarations get parent_name", () => {
      const src = `export function outer(): void {\n  function inner(): void {}\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "inner")?.parent_name).toBe(
        "outer",
      );
    });

    it("nested arrow functions get parent_name", () => {
      const src = `export function Component(): void {\n  const handler = (): void => {};\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.symbols.find((s) => s.name === "handler")?.parent_name).toBe(
        "Component",
      );
    });

    it("class methods get parent_name", () => {
      const src = `export class Svc {\n  async run(id: string): Promise<void> {}\n  static create(): Svc { return new Svc(); }\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const run = d.symbols.find((s) => s.name === "run");
      expect(run?.parent_name).toBe("Svc");
      expect(run?.kind).toBe("method");
      expect(run?.signature).toContain("async");
      const create = d.symbols.find((s) => s.name === "create");
      expect(create?.parent_name).toBe("Svc");
      expect(create?.signature).toContain("static");
    });

    it("class properties get parent_name", () => {
      const src = `export class Config {\n  private host: string;\n  readonly port = 3000;\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const host = d.symbols.find((s) => s.name === "host");
      expect(host?.parent_name).toBe("Config");
      expect(host?.kind).toBe("property");
      expect(host?.signature).toContain("private");
      const port = d.symbols.find((s) => s.name === "port");
      expect(port?.signature).toContain("readonly");
      expect(port?.value).toBe("3000");
    });

    it("class getters get kind getter", () => {
      const src = `export class Store {\n  get count(): number { return 0; }\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const count = d.symbols.find((s) => s.name === "count");
      expect(count?.kind).toBe("getter");
      expect(count?.parent_name).toBe("Store");
    });
  });

  describe("call graph extraction", () => {
    it("extracts function-to-function calls", () => {
      const src = `function foo() { bar(); baz(); }\nfunction bar() {}\nfunction baz() {}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.calls).toHaveLength(2);
      expect(d.calls[0]).toMatchObject({
        caller_name: "foo",
        caller_scope: "foo",
        callee_name: "bar",
      });
      expect(d.calls[1]).toMatchObject({
        caller_name: "foo",
        caller_scope: "foo",
        callee_name: "baz",
      });
    });

    it("extracts member expression calls", () => {
      const src = `function init() { console.log("hi"); arr.push(1); }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const names = d.calls.map((c) => c.callee_name);
      expect(names).toContain("console.log");
      expect(names).toContain("arr.push");
    });

    it("deduplicates calls within same caller", () => {
      const src = `function process() { save(); save(); save(); }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]).toMatchObject({
        caller_name: "process",
        callee_name: "save",
      });
    });

    it("tracks calls from arrow functions", () => {
      const src = `const handler = () => { validate(); submit(); };\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.calls).toHaveLength(2);
      expect(d.calls[0].caller_name).toBe("handler");
      expect(d.calls[0].caller_scope).toBe("handler");
    });

    it("skips module-level calls (no caller scope)", () => {
      const src = `configure();\nfunction foo() { bar(); }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]).toMatchObject({
        caller_name: "foo",
        callee_name: "bar",
      });
    });

    it("tracks calls from class methods with qualified scope", () => {
      const src = `class Svc {\n  run() { this.validate(); fetch(); }\n}\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      const fromRun = d.calls.filter((c) => c.caller_name === "run");
      expect(fromRun.length).toBe(2);
      expect(fromRun.map((c) => c.callee_name)).toContain("fetch");
      expect(fromRun.map((c) => c.callee_name)).toContain("this.validate");
      expect(fromRun[0].caller_scope).toBe("Svc.run");
    });

    it("distinguishes same-named methods across classes", () => {
      const src = `class A { run() { foo(); } }\nclass B { run() { bar(); } }\n`;
      const d = extractFileData("/proj/x.ts", src, "x.ts");
      expect(d.calls).toHaveLength(2);
      const scopes = d.calls.map((c) => c.caller_scope);
      expect(scopes).toContain("A.run");
      expect(scopes).toContain("B.run");
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
