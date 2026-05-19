/**
 * Dynamic `import()` sites — module specifier kind, text, and async-fn context.
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

function classifySource(
  source: string,
  node: any,
): {
  source_kind: "literal" | "template" | "expression";
  source_text: string;
} {
  const src = node.source;
  if (src?.type === "Literal" && typeof src.value === "string") {
    return { source_kind: "literal", source_text: src.value };
  }
  if (src?.type === "TemplateLiteral") {
    return {
      source_kind: "template",
      source_text: source.slice(src.start, src.end),
    };
  }
  if (src) {
    return {
      source_kind: "expression",
      source_text: source.slice(src.start, src.end),
    };
  }
  return { source_kind: "expression", source_text: "" };
}

function isAsyncFnNode(node: any): boolean {
  return Boolean(node?.async);
}

export const dynamicImportsExtractor: TierExtractor = {
  tierId: "dynamic-imports",
  register(visitor, ctx) {
    const { dynamicImports, relPath, lineMap, source, scopes } = ctx;
    let asyncDepth = 0;

    const enterAsync = (node: any) => {
      if (isAsyncFnNode(node)) asyncDepth++;
    };
    const exitAsync = (node: any) => {
      if (isAsyncFnNode(node)) asyncDepth--;
    };

    Object.assign(visitor, {
      FunctionDeclaration: enterAsync,
      "FunctionDeclaration:exit": exitAsync,
      FunctionExpression: enterAsync,
      "FunctionExpression:exit": exitAsync,
      ArrowFunctionExpression: enterAsync,
      "ArrowFunctionExpression:exit": exitAsync,
      MethodDefinition(node: any) {
        enterAsync(node.value);
      },
      "MethodDefinition:exit"(node: any) {
        exitAsync(node.value);
      },

      ImportExpression(node: any) {
        const tokenStart = node.source?.start ?? node.start;
        const lineStart = offsetToLine(lineMap, tokenStart);
        const lineStartOffset = lineMap[lineStart - 1] ?? 0;
        const { source_kind, source_text } = classifySource(source, node);
        dynamicImports.push({
          file_path: relPath,
          line_start: lineStart,
          column_start: tokenStart - lineStartOffset,
          source_kind,
          source_text,
          resolved_path: null,
          in_async_fn: asyncDepth > 0 ? 1 : 0,
          scope_local_id: scopes.currentLocalId(),
        });
      },
    });
  },
};
