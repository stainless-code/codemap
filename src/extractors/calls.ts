/**
 * Calls — one row per (caller, callee) edge, deduped per
 * `(caller_scope, callee_name, call_kind)` per file. Module-level calls
 * skipped (`caller` must be non-null). Chained with `componentsExtractor`'s
 * CallExpression handler (hook detection).
 *
 * Per [R.6]: `line_start` / `column_*` record the callee **identifier
 * token** position (`foo` in `foo()`; `.property` in `obj.property()`),
 * NOT the surrounding `CallExpression`.
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

function argsCount(
  args: readonly { type?: string }[] | undefined,
): number | null {
  if (!args?.length) return 0;
  if (args.some((a) => a.type === "SpreadElement")) return null;
  return args.length;
}

function calleeFromNode(callee: any): {
  calleeName: string | null;
  tokenStart: number | undefined;
  tokenEnd: number | undefined;
  isMethodCall: boolean;
} {
  let calleeName: string | null = null;
  let tokenStart: number | undefined;
  let tokenEnd: number | undefined;
  let isMethodCall = false;

  if (callee?.type === "Identifier") {
    calleeName = callee.name;
    tokenStart = callee.start;
    tokenEnd = callee.end;
  } else if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.name
  ) {
    isMethodCall = true;
    const segments: string[] = [callee.property.name];
    let cursor: any = callee.object;
    while (
      cursor?.type === "MemberExpression" &&
      !cursor.computed &&
      cursor.property?.name
    ) {
      segments.unshift(cursor.property.name);
      cursor = cursor.object;
    }
    if (cursor?.type === "Identifier") {
      segments.unshift(cursor.name);
      calleeName = segments.join(".");
    } else if (cursor?.type === "ThisExpression") {
      segments.unshift("this");
      calleeName = segments.join(".");
    }
    tokenStart = callee.property.start;
    tokenEnd = callee.property.end;
  }

  return { calleeName, tokenStart, tokenEnd, isMethodCall };
}

function isOptionalChain(node: any, callee: any): boolean {
  return Boolean(node.optional || callee?.optional);
}

export const callsExtractor: TierExtractor = {
  tierId: "calls",
  register(visitor, ctx) {
    const { scopes, calls, relPath, lineMap } = ctx;
    const seenCalls = new Set<string>();

    const recordCall = (
      node: any,
      callee: any,
      args: readonly { type?: string }[] | undefined,
      isConstructorCall: boolean,
    ) => {
      const caller = scopes.currentParent();
      if (!caller) return;

      const { calleeName, tokenStart, tokenEnd, isMethodCall } =
        calleeFromNode(callee);
      if (calleeName && tokenStart !== undefined && tokenEnd !== undefined) {
        const scope = scopes.currentScope();
        const callKind = isConstructorCall ? "new" : "call";
        const key = `${scope}>>${calleeName}>>${callKind}`;
        if (!seenCalls.has(key)) {
          seenCalls.add(key);
          const lineStart = offsetToLine(lineMap, tokenStart);
          const lineStartOffset = lineMap[lineStart - 1]!;
          calls.push({
            file_path: relPath,
            caller_name: caller,
            caller_scope: scope,
            callee_name: calleeName,
            line_start: lineStart,
            column_start: tokenStart - lineStartOffset,
            column_end: tokenEnd - lineStartOffset,
            args_count: argsCount(args),
            is_method_call: isMethodCall ? 1 : 0,
            is_constructor_call: isConstructorCall ? 1 : 0,
            is_optional_chain: isOptionalChain(node, callee) ? 1 : 0,
          });
        }
      }
    };

    Object.assign(visitor, {
      CallExpression(node: any) {
        recordCall(node, node.callee, node.arguments, false);
      },
      NewExpression(node: any) {
        recordCall(node, node.callee, node.arguments, true);
      },
    });
  },
};
