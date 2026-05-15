/**
 * Operational signal extractor: every console.* / debugger / throw /
 * process.env access becomes a queryable row. Powers leftover-console,
 * debugger-shipped, env-var audits, and panic-point inventories.
 *
 * Throw expression text is the raw source slice — keeps strings and
 * `new Error(...)` distinguishable without re-stringifying the AST.
 */

import { offsetToLine } from "./offsets";
import type { ExtractContext, TierExtractor } from "./types";

function isProcessEnv(node: any): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    node.object?.name === "process" &&
    node.property?.type === "Identifier" &&
    node.property?.name === "env"
  );
}

export const runtimeMarkersExtractor: TierExtractor = {
  tierId: "runtime-markers",
  register(visitor, ctx: ExtractContext) {
    const { relPath, lineMap, source, scopes } = ctx;
    const out = ctx.runtimeMarkers;

    function emit(
      kind: "console" | "debugger" | "throw" | "process-env",
      start: number,
      end: number,
      detail: string | null,
    ) {
      const lineStart = offsetToLine(lineMap, start);
      const lineStartOffset = lineMap[lineStart - 1] ?? 0;
      out.push({
        file_path: relPath,
        kind,
        line_start: lineStart,
        column_start: start - lineStartOffset,
        detail,
        scope_local_id: scopes.currentLocalId(),
      });
      void end;
    }

    Object.assign(visitor, {
      // console.<method>(...)
      CallExpression(node: any) {
        const callee = node.callee;
        if (
          callee?.type === "MemberExpression" &&
          !callee.computed &&
          callee.object?.type === "Identifier" &&
          callee.object.name === "console" &&
          callee.property?.type === "Identifier"
        ) {
          emit("console", callee.start, callee.end, callee.property.name);
        }
      },
      DebuggerStatement(node: any) {
        emit("debugger", node.start, node.end, null);
      },
      ThrowStatement(node: any) {
        const arg = node.argument;
        const text = arg ? source.slice(arg.start, arg.end) : null;
        // Truncate long throw expressions — keep audit rows readable.
        const detail =
          text && text.length > 200 ? text.slice(0, 197) + "..." : text;
        emit("throw", node.start, node.end, detail);
      },
      // process.env.X — emit the MemberExpression's outer (process.env.X),
      // detail is X. `process.env` bare without `.X` is a less common
      // pattern (object iteration) — caught by the inner check.
      MemberExpression(node: any) {
        // outer: (process.env).X — node.object is `process.env`, node.property is X.
        if (
          isProcessEnv(node.object) &&
          !node.computed &&
          node.property?.type === "Identifier"
        ) {
          emit(
            "process-env",
            node.object.start,
            node.property.end,
            node.property.name,
          );
        }
      },
    });
  },
};
