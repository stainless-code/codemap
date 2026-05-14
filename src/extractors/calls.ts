/**
 * Calls — one row per (caller, callee) edge, deduped per
 * `(caller_scope, callee_name)` per file. Module-level calls skipped
 * (`caller` must be non-null). Chained with `componentsExtractor`'s
 * CallExpression handler (hook detection).
 *
 * Per [R.6]: `line_start` / `column_*` record the callee **identifier
 * token** position (`foo` in `foo()`; `.property` in `obj.property()`),
 * NOT the surrounding `CallExpression`.
 */

import { offsetToLine } from "./offsets";
import type { TierExtractor } from "./types";

export const callsExtractor: TierExtractor = {
  tierId: "calls",
  register(visitor, ctx) {
    const { scopes, calls, relPath, lineMap } = ctx;
    const seenCalls = new Set<string>();

    Object.assign(visitor, {
      CallExpression(node: any) {
        const caller = scopes.currentParent();
        if (!caller) return;
        const callee = node.callee;
        let calleeName: string | null = null;
        // `tokenStart` / `tokenEnd` track the identifier token whose
        // position we record (per R.6) — for `obj.foo()` that's the
        // `foo` property, not the whole `obj.foo` member expression.
        let tokenStart: number | undefined;
        let tokenEnd: number | undefined;
        if (callee?.type === "Identifier") {
          calleeName = callee.name;
          tokenStart = callee.start;
          tokenEnd = callee.end;
        } else if (
          callee?.type === "MemberExpression" &&
          callee.property?.name
        ) {
          if (callee.object?.type === "Identifier") {
            calleeName = `${callee.object.name}.${callee.property.name}`;
          } else if (callee.object?.type === "ThisExpression") {
            calleeName = `this.${callee.property.name}`;
          }
          tokenStart = callee.property.start;
          tokenEnd = callee.property.end;
        }
        if (calleeName && tokenStart !== undefined && tokenEnd !== undefined) {
          const scope = scopes.currentScope();
          const key = `${scope}>>${calleeName}`;
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
            });
          }
        }
      },
    });
  },
};
