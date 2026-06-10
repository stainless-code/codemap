/**
 * Structural body fingerprint for function-shaped symbols. Canonical AST walk
 * on function bodies; symbol index via `complexity.markArrowSymbol` / `getArrowSymbol`.
 */

import type { SymbolRow } from "../db";
import { hashContent } from "../hash";
import type { TierExtractor } from "./types";

/** Return-position absent values (`null` / `undefined` / `void 0` / bare `return`) → this token. */
const NULLISH_LITERAL = "Literal:nullish";

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

/** SHA-256 hex of canonical body; NULL when body missing or `body_line_count < 2`. */
export function hashFunctionBody(
  body: unknown,
  bodyLineCount: number | null | undefined,
): string | null {
  if (!body || (bodyLineCount ?? 0) < 2) return null;
  return hashContent(canonicalizeBody(body));
}

function walk(node: unknown, parts: string[], normalizeNullish = false): void {
  if (node == null) return;

  if (Array.isArray(node)) {
    parts.push("[");
    for (const item of node) walk(item, parts, normalizeNullish);
    parts.push("]");
    return;
  }

  if (typeof node !== "object") return;

  const n = node as { type?: string };

  if (n.type === "Identifier" || n.type === "BindingIdentifier") {
    if (normalizeNullish && (node as { name?: string }).name === "undefined") {
      parts.push(NULLISH_LITERAL);
      return;
    }
    parts.push("$id");
    return;
  }

  if (
    normalizeNullish &&
    n.type === "UnaryExpression" &&
    (node as { operator?: string; prefix?: boolean }).operator === "void" &&
    (node as { prefix?: boolean }).prefix
  ) {
    const voidArg = (node as { argument?: { type?: string; value?: unknown } })
      .argument;
    if (voidArg?.type === "Literal" && voidArg.value === 0) {
      parts.push(NULLISH_LITERAL);
      return;
    }
  }

  if (n.type === "ReturnStatement") {
    parts.push(n.type);
    const arg = (node as { argument?: unknown }).argument;
    parts.push("argument");
    if (arg == null) {
      parts.push(NULLISH_LITERAL);
    } else {
      walk(arg, parts, true);
    }
    return;
  }

  if (n.type === "PrivateIdentifier") {
    parts.push("$id");
    return;
  }

  if (n.type === "Literal") {
    const kind = literalKind(
      node as { value?: unknown; bigint?: string; regex?: unknown },
    );
    if (normalizeNullish && kind === "nullish") {
      parts.push(NULLISH_LITERAL);
    } else {
      parts.push(`Literal:${kind}`);
    }
    return;
  }

  if (n.type === "TemplateElement") {
    parts.push("TemplateElement");
    return;
  }

  if (n.type === "TemplateLiteral") {
    const tl = node as { quasis?: unknown[]; expressions?: unknown[] };
    parts.push("TemplateLiteral");
    walk(tl.quasis, parts, normalizeNullish);
    walk(tl.expressions, parts, normalizeNullish);
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
    walk(record[key], parts, normalizeNullish);
  }
}

function literalKind(node: {
  value?: unknown;
  bigint?: string;
  regex?: unknown;
}): string {
  if (node.regex != null) return "regexp";
  if (node.bigint != null) return "bigint";
  if (node.value === null) return "nullish";
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

export const bodyHashExtractor: TierExtractor = {
  tierId: "body-hash",
  register(visitor, ctx) {
    const onFnExit = (node: { body?: unknown }) => {
      assignBodyHashForSymbolIndex(
        ctx.symbols,
        ctx.complexity.getArrowSymbol(node),
        node.body,
      );
    };

    Object.assign(visitor, {
      "FunctionDeclaration:exit": onFnExit,
      "ArrowFunctionExpression:exit": onFnExit,
      "FunctionExpression:exit": onFnExit,
    });
  },
};
