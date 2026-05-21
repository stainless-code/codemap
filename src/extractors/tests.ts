/**
 * Test-suite metadata extractor: every describe/it/test/suite block with
 * its skip/only/todo flags + hierarchy.
 *
 * Framework detected from the file's static imports — if multiple test
 * frameworks are imported (rare), priority is vitest > jest > bun-test >
 * node-test > mocha. Files with no test-framework import default to
 * 'unknown' and still emit rows when patterns match (mocha-style global
 * describe with no imports is common in older codebases).
 */

import { offsetToLine } from "./offsets";
import type { ExtractContext, TierExtractor } from "./types";

type TestKind = "describe" | "it" | "test" | "suite" | "context";
type Framework =
  | "vitest"
  | "jest"
  | "bun-test"
  | "node-test"
  | "mocha"
  | "unknown";

const TEST_KINDS = new Set<TestKind>([
  "describe",
  "it",
  "test",
  "suite",
  "context",
]);

function detectFramework(ctx: ExtractContext): Framework {
  const sources = new Set<string>();
  for (const imp of ctx.imports) sources.add(imp.source);
  if (sources.has("vitest")) return "vitest";
  if (sources.has("@jest/globals") || sources.has("jest")) return "jest";
  if (sources.has("bun:test")) return "bun-test";
  if (sources.has("node:test") || sources.has("test")) return "node-test";
  if (sources.has("mocha")) return "mocha";
  return "unknown";
}

/**
 * Pull the (kind, modifier) from a callee like `describe`, `it.skip`,
 * `test.only`, `it.todo`. Returns null when the callee isn't a known
 * test entrypoint. `.each` variants count as their base kind; we don't
 * multiply rows for parametrised cases (one row per template).
 */
function parseTestCallee(callee: any): {
  kind: TestKind;
  modifier: "skip" | "only" | "todo" | null;
} | null {
  if (callee?.type === "Identifier") {
    if (TEST_KINDS.has(callee.name)) {
      return { kind: callee.name, modifier: null };
    }
    return null;
  }
  if (callee?.type === "MemberExpression" && !callee.computed) {
    const obj = callee.object;
    const prop = callee.property;
    if (obj?.type !== "Identifier" || prop?.type !== "Identifier") return null;
    if (!TEST_KINDS.has(obj.name)) return null;
    if (prop.name === "skip") return { kind: obj.name, modifier: "skip" };
    if (prop.name === "only") return { kind: obj.name, modifier: "only" };
    if (prop.name === "todo") return { kind: obj.name, modifier: "todo" };
    if (prop.name === "each") return { kind: obj.name, modifier: null };
    return null;
  }
  return null;
}

function extractName(arg: any): string | null {
  if (!arg) return null;
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "StringLiteral" && typeof arg.value === "string") {
    return arg.value;
  }
  if (arg.type === "TemplateLiteral") {
    // Use the cooked text of all quasis joined; expressions become `${…}`
    // markers so the audit row is human-readable.
    const parts: string[] = [];
    const quasis = arg.quasis ?? [];
    const exprs = arg.expressions ?? [];
    for (let i = 0; i < quasis.length; i++) {
      parts.push(quasis[i].value?.cooked ?? "");
      if (i < exprs.length) parts.push("${…}");
    }
    return parts.join("");
  }
  return null;
}

export const testsExtractor: TierExtractor = {
  tierId: "tests",
  register(visitor, ctx) {
    const framework = detectFramework(ctx);
    const rows = ctx.testSuites;
    // Active describe parent (index into rows) as we descend.
    const parentStack: number[] = [];

    Object.assign(visitor, {
      CallExpression(node: any) {
        let parsed = parseTestCallee(node.callee);
        if (!parsed && node.callee?.type === "CallExpression") {
          parsed = parseTestCallee(node.callee.callee);
          if (!parsed) return;
          const name = extractName(node.arguments?.[0]);
          if (name === null) return;
          const lineStart = offsetToLine(ctx.lineMap, node.start);
          const lineEnd = offsetToLine(ctx.lineMap, node.end);
          const idx = rows.length;
          rows.push({
            file_path: ctx.relPath,
            name,
            kind: parsed.kind,
            line_start: lineStart,
            line_end: lineEnd,
            parent_index: parentStack[parentStack.length - 1] ?? null,
            is_skipped: parsed.modifier === "skip" ? 1 : 0,
            is_only: parsed.modifier === "only" ? 1 : 0,
            is_todo: parsed.modifier === "todo" ? 1 : 0,
            framework,
          });
          if (
            parsed.kind === "describe" ||
            parsed.kind === "suite" ||
            parsed.kind === "context"
          ) {
            parentStack.push(idx);
          }
          return;
        }
        if (!parsed) return;
        const name = extractName(node.arguments?.[0]);
        if (name === null) return; // skip anonymous / dynamic
        const lineStart = offsetToLine(ctx.lineMap, node.start);
        const lineEnd = offsetToLine(ctx.lineMap, node.end);
        const idx = rows.length;
        rows.push({
          file_path: ctx.relPath,
          name,
          kind: parsed.kind,
          line_start: lineStart,
          line_end: lineEnd,
          parent_index: parentStack[parentStack.length - 1] ?? null,
          is_skipped: parsed.modifier === "skip" ? 1 : 0,
          is_only: parsed.modifier === "only" ? 1 : 0,
          is_todo: parsed.modifier === "todo" ? 1 : 0,
          framework,
        });
        // Only `describe` / `suite` / `context` can host children.
        if (
          parsed.kind === "describe" ||
          parsed.kind === "suite" ||
          parsed.kind === "context"
        ) {
          parentStack.push(idx);
        }
      },
      "CallExpression:exit"(node: any) {
        let parsed = parseTestCallee(node.callee);
        if (!parsed && node.callee?.type === "CallExpression") {
          parsed = parseTestCallee(node.callee.callee);
        }
        if (!parsed) return;
        if (
          parsed.kind === "describe" ||
          parsed.kind === "suite" ||
          parsed.kind === "context"
        ) {
          const name = extractName(node.arguments?.[0]);
          if (name === null) return;
          parentStack.pop();
        }
      },
    });
  },
};
