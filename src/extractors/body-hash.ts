/**
 * Structural body fingerprint for function-shaped symbols. Canonical AST walk
 * per plan B.7–B.8/B.11 on `FunctionDeclaration`, named arrow/const inits,
 * and class methods (via `complexity.markArrowSymbol` bridge).
 */

import type { SymbolRow } from "../db";
import { hashContent } from "../hash";
import { offsetToLine } from "./offsets";
import type { ExtractContext, TierExtractor } from "./types";

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "raw",
  "cooked",
  "name",
  "value",
  "bigint",
  "regex",
  "flags",
  "optional",
  "decorators",
  "typeAnnotation",
  "returnType",
  "typeParameters",
]);

/** Depth-first canonical serialization of a function `body` subtree. */
export function canonicalizeBody(body: unknown): string {
  const parts: string[] = [];
  walk(body, parts);
  return parts.join("");
}

/** SHA-256 hex of canonical body; NULL when body missing or trivial (B.13). */
export function hashFunctionBody(
  body: unknown,
  bodyLineCount: number | null | undefined,
): string | null {
  if (!body || (bodyLineCount ?? 0) < 2) return null;
  return hashContent(canonicalizeBody(body));
}

function walk(node: unknown, parts: string[]): void {
  if (node == null) return;

  if (Array.isArray(node)) {
    parts.push("[");
    for (const item of node) walk(item, parts);
    parts.push("]");
    return;
  }

  if (typeof node !== "object") return;

  const n = node as { type?: string };

  if (n.type === "Identifier" || n.type === "BindingIdentifier") {
    parts.push("$id");
    return;
  }

  if (n.type === "PrivateIdentifier") {
    parts.push("$id");
    return;
  }

  if (n.type === "Literal") {
    parts.push(
      `Literal:${literalKind(node as { value?: unknown; bigint?: string; regex?: unknown })}`,
    );
    return;
  }

  if (n.type === "TemplateElement") {
    parts.push("TemplateElement");
    return;
  }

  if (n.type === "TemplateLiteral") {
    const tl = node as { quasis?: unknown[]; expressions?: unknown[] };
    parts.push("TemplateLiteral");
    walk(tl.quasis, parts);
    walk(tl.expressions, parts);
    return;
  }

  if (!n.type) return;

  parts.push(n.type);
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => k !== "type" && !SKIP_KEYS.has(k))
    .sort();
  for (const key of keys) {
    parts.push(key);
    walk(record[key], parts);
  }
}

function literalKind(node: {
  value?: unknown;
  bigint?: string;
  regex?: unknown;
}): string {
  if (node.regex != null) return "regexp";
  if (node.bigint != null) return "bigint";
  if (node.value === null) return "null";
  return typeof node.value;
}

const FUNCTION_SHAPED_KINDS = new Set([
  "function",
  "method",
  "getter",
  "setter",
]);

function assignBodyHashForSymbolIndex(
  symbols: SymbolRow[],
  symbolIndex: number | undefined,
  body: unknown,
): void {
  if (symbolIndex === undefined || symbolIndex < 0) return;
  const sym = symbols[symbolIndex];
  if (!sym || !FUNCTION_SHAPED_KINDS.has(sym.kind)) return;
  sym.body_hash = hashFunctionBody(body, sym.body_line_count);
}

function assignBodyHashForNamedFunction(
  ctx: ExtractContext,
  node: { id?: { name?: string }; body?: unknown; start?: number },
): void {
  const name = node.id?.name;
  if (!name || node.start === undefined) return;
  const lineStart = offsetToLine(ctx.lineMap, node.start);
  const sym = ctx.symbols.find(
    (s) =>
      s.name === name &&
      s.kind === "function" &&
      s.file_path === ctx.relPath &&
      s.line_start === lineStart,
  );
  if (!sym) return;
  sym.body_hash = hashFunctionBody(node.body, sym.body_line_count);
}

export const bodyHashExtractor: TierExtractor = {
  tierId: "body-hash",
  register(visitor, ctx) {
    const onFnExprExit = (node: { body?: unknown }) => {
      assignBodyHashForSymbolIndex(
        ctx.symbols,
        ctx.complexity.getArrowSymbol(node),
        node.body,
      );
    };

    Object.assign(visitor, {
      "FunctionDeclaration:exit"(node: {
        id?: { name?: string };
        body?: unknown;
        start?: number;
      }) {
        assignBodyHashForNamedFunction(ctx, node);
      },
      "ArrowFunctionExpression:exit": onFnExprExit,
      "FunctionExpression:exit": onFnExprExit,
    });
  },
};
