/**
 * Behavioral substrate — async/await sites, try/catch, decorators (Tier 5).
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

export interface ParsedAsyncCall {
  file_path: string;
  caller_scope: string;
  awaited_expression: string;
  awaited_callee_name: string | null;
  line_start: number;
  column_start: number;
  in_loop: number;
  in_try: number;
  scope_local_id: number;
}

export interface ParsedTryCatch {
  file_path: string;
  containing_scope_local_id: number;
  try_line_start: number;
  try_line_end: number;
  has_catch: number;
  catch_param: string | null;
  catch_rethrows: number;
  catch_logs_only: number;
  has_finally: number;
}

export interface ParsedDecorator {
  file_path: string;
  target_kind: "class" | "method" | "property" | "parameter" | "accessor";
  target_line_start: number;
  name: string;
  line: number;
  column_start: number;
  args_text: string | null;
}

export interface ParsedJsdocTag {
  file_path: string;
  symbol_name: string;
  symbol_line_start: number;
  tag: string;
  name: string | null;
  type_text: string | null;
  description: string | null;
}

function calleeNameFromExpression(expr: any): string | null {
  if (expr?.type === "CallExpression") {
    const callee = expr.callee;
    if (callee?.type === "Identifier") return callee.name;
    if (
      callee?.type === "MemberExpression" &&
      !callee.computed &&
      callee.property?.type === "Identifier"
    ) {
      return callee.property.name;
    }
  }
  return null;
}

function decoratorName(node: any, source: string): string {
  const expr = node.expression;
  if (expr?.type === "Identifier") return expr.name;
  if (expr?.type === "CallExpression") {
    const callee = expr.callee;
    if (callee?.type === "Identifier") return callee.name;
    if (
      callee?.type === "MemberExpression" &&
      callee.property?.type === "Identifier"
    ) {
      return callee.property.name;
    }
    return source.slice(expr.callee.start, expr.callee.end);
  }
  return source.slice(node.start, node.end);
}

function catchParamName(param: any): string | null {
  if (!param) return null;
  if (param.type === "Identifier") return param.name;
  return null;
}

function bodyHasThrow(body: any, catchParam: string | null): boolean {
  if (!body?.body?.length) return false;
  const stack: any[] = [...body.body];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "ThrowStatement") {
      const arg = node.argument;
      if (!arg) return true;
      if (arg.type === "Identifier" && catchParam && arg.name === catchParam) {
        return true;
      }
      if (arg.type === "Identifier" && !catchParam) return true;
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (val && typeof val === "object") {
        if (Array.isArray(val)) stack.push(...val);
        else if (val.type) stack.push(val);
      }
    }
  }
  return false;
}

function isLogsOnlyCatch(body: any): boolean {
  if (!body?.body?.length) return false;
  for (const stmt of body.body) {
    if (stmt.type === "ThrowStatement") return false;
    if (stmt.type === "ExpressionStatement") {
      const expr = stmt.expression;
      if (expr?.type === "CallExpression") {
        const callee = expr.callee;
        if (
          callee?.type === "MemberExpression" &&
          callee.object?.type === "Identifier" &&
          callee.object.name === "console"
        ) {
          continue;
        }
      }
      return false;
    }
    return false;
  }
  return body.body.length > 0;
}

function isLoopNode(type: string): boolean {
  return (
    type === "ForStatement" ||
    type === "ForInStatement" ||
    type === "ForOfStatement" ||
    type === "WhileStatement" ||
    type === "DoWhileStatement"
  );
}

export function parseJsDocTags(doc: string): Array<{
  tag: string;
  name: string | null;
  type_text: string | null;
  description: string | null;
}> {
  const out: Array<{
    tag: string;
    name: string | null;
    type_text: string | null;
    description: string | null;
  }> = [];
  for (const rawLine of doc.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("@")) continue;
    let m = /^@param\s+(?:\{([^}]*)\}\s+)?(\S+)\s*(.*)$/.exec(line);
    if (m) {
      out.push({
        tag: "@param",
        name: m[2] ?? null,
        type_text: m[1] || null,
        description: m[3]?.trim() || null,
      });
      continue;
    }
    m = /^@returns?\s+(?:\{([^}]*)\}\s+)?(.*)$/.exec(line);
    if (m) {
      out.push({
        tag: "@returns",
        name: null,
        type_text: m[1] || null,
        description: m[2]?.trim() || null,
      });
      continue;
    }
    m = /^@throws\s+(?:\{([^}]*)\}\s+)?(.*)$/.exec(line);
    if (m) {
      out.push({
        tag: "@throws",
        name: null,
        type_text: m[1] || null,
        description: m[2]?.trim() || null,
      });
      continue;
    }
    m = /^@(\w+)\s+(.*)$/.exec(line);
    if (m) {
      out.push({
        tag: `@${m[1]}`,
        name: null,
        type_text: null,
        description: m[2]?.trim() || null,
      });
    }
  }
  return out;
}

export const behavioralExtractor: TierExtractor = {
  tierId: "behavioral",
  register(visitor, ctx) {
    const { relPath, lineMap, source, scopes } = ctx;
    const asyncCalls = ctx.asyncCalls;
    const tryCatchRows = ctx.tryCatchRows;
    const decorators = ctx.decorators;
    let loopDepth = 0;
    let tryDepth = 0;

    const enterLoop = (node: any) => {
      if (isLoopNode(node.type)) loopDepth++;
    };
    const exitLoop = (node: any) => {
      if (isLoopNode(node.type)) loopDepth--;
    };

    function recordDecorator(
      dec: any,
      targetKind: ParsedDecorator["target_kind"],
      targetLineStart: number,
    ) {
      const line = offsetToLine(lineMap, dec.start);
      const lineStartOffset = lineMap[line - 1] ?? 0;
      const expr = dec.expression;
      const argsText =
        expr?.type === "CallExpression"
          ? source.slice(expr.arguments[0]?.start ?? expr.start, expr.end)
          : null;
      decorators.push({
        file_path: relPath,
        target_kind: targetKind,
        target_line_start: targetLineStart,
        name: decoratorName(dec, source),
        line,
        column_start: dec.start - lineStartOffset,
        args_text: argsText,
      });
    }

    Object.assign(visitor, {
      ForStatement: enterLoop,
      "ForStatement:exit": exitLoop,
      ForInStatement: enterLoop,
      "ForInStatement:exit": exitLoop,
      ForOfStatement: enterLoop,
      "ForOfStatement:exit": exitLoop,
      WhileStatement: enterLoop,
      "WhileStatement:exit": exitLoop,
      DoWhileStatement: enterLoop,
      "DoWhileStatement:exit": exitLoop,

      TryStatement(node: any) {
        tryDepth++;
        const handler = node.handler;
        const catchParam = catchParamName(handler?.param);
        const catchBody = handler?.body;
        tryCatchRows.push({
          file_path: relPath,
          containing_scope_local_id: scopes.currentLocalId(),
          try_line_start: offsetToLine(lineMap, node.block.start),
          try_line_end: offsetToLine(lineMap, node.block.end),
          has_catch: handler ? 1 : 0,
          catch_param: catchParam,
          catch_rethrows:
            catchBody && bodyHasThrow(catchBody, catchParam) ? 1 : 0,
          catch_logs_only: catchBody && isLogsOnlyCatch(catchBody) ? 1 : 0,
          has_finally: node.finalizer ? 1 : 0,
        });
      },
      "TryStatement:exit"() {
        tryDepth--;
      },

      AwaitExpression(node: any) {
        const lineStart = offsetToLine(lineMap, node.start);
        const lineStartOffset = lineMap[lineStart - 1] ?? 0;
        asyncCalls.push({
          file_path: relPath,
          caller_scope: scopes.currentScope(),
          awaited_expression: source.slice(node.start, node.end),
          awaited_callee_name: calleeNameFromExpression(node.argument),
          line_start: lineStart,
          column_start: node.start - lineStartOffset,
          in_loop: loopDepth > 0 ? 1 : 0,
          in_try: tryDepth > 0 ? 1 : 0,
          scope_local_id: scopes.currentLocalId(),
        });
      },

      ClassDeclaration(node: any) {
        const targetLine = offsetToLine(lineMap, node.id?.start ?? node.start);
        for (const dec of node.decorators ?? []) {
          recordDecorator(dec, "class", targetLine);
        }
      },

      MethodDefinition(node: any) {
        const targetLine = offsetToLine(lineMap, node.key.start);
        const kind =
          node.kind === "get" || node.kind === "set" ? "accessor" : "method";
        for (const dec of node.decorators ?? []) {
          recordDecorator(dec, kind, targetLine);
        }
      },

      PropertyDefinition(node: any) {
        const targetLine = offsetToLine(lineMap, node.key.start);
        for (const dec of node.decorators ?? []) {
          recordDecorator(dec, "property", targetLine);
        }
      },
    });
  },

  finalize(ctx) {
    for (const s of ctx.symbols) {
      if (!s.doc_comment) continue;
      if (s.kind === "param" || s.kind === "type-param") continue;
      for (const t of parseJsDocTags(s.doc_comment)) {
        ctx.jsdocTags.push({
          file_path: s.file_path,
          symbol_name: s.name,
          symbol_line_start: s.line_start,
          ...t,
        });
      }
    }
  },
};
