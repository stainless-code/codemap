/**
 * Scope tracker + scopes extractor. Shared-state pattern per [R.17]:
 * tracker lives on `ctx.scopes`; mutated by any extractor whose handler
 * needs to push / pop scope.
 *
 * Per Tier 2 ([R.11]) the tracker ALSO records each push as a `ScopeRow`
 * with a per-file 0-based `local_id` counter. Module scope = `local_id 0`,
 * inserted eagerly by the factory. Nested pushes get monotonically-
 * increasing ids; `parent_local_id` points at the previous-top.
 * `scopesExtractor.finalize()` flushes the recorded rows to `ctx`.
 *
 * `scopesExtractor` owns only pure-scope handlers (`MethodDefinition` /
 * `:exit`). Handlers that interleave scope mutation with row emission
 * (`symbolsExtractor`'s FunctionDeclaration / VariableDeclaration /
 * ClassDeclaration) call `scopes.push/pop` inline so observable
 * read/push ordering matches the pre-lift implementation.
 */

import type { ScopeRow } from "../db";
import type { ScopeTracker, TierExtractor } from "./types";

export function createScopeTracker(filePath: string): ScopeTracker {
  const stack: { name: string; localId: number }[] = [];
  let scopeStr = "";
  const recorded: ScopeRow[] = [
    {
      file_path: filePath,
      local_id: 0,
      kind: "module",
      parent_local_id: null,
      line_start: 1,
      line_end: 1, // Updated by finaliseModule().
      owner_symbol_name: null,
    },
  ];
  let nextLocalId = 1;

  return {
    push(name, kind, lineStart, lineEnd) {
      const localId = nextLocalId++;
      stack.push({ name, localId });
      scopeStr = scopeStr ? `${scopeStr}.${name}` : name;
      recorded.push({
        file_path: filePath,
        local_id: localId,
        kind: kind ?? "function",
        parent_local_id:
          stack.length > 1 ? stack[stack.length - 2]!.localId : 0,
        line_start: lineStart ?? 0,
        line_end: lineEnd ?? 0,
        owner_symbol_name: name || null,
      });
    },
    pop() {
      stack.pop();
      scopeStr = stack.map((s) => s.name).join(".");
    },
    currentParent() {
      return stack.length ? stack[stack.length - 1]!.name : null;
    },
    currentScope() {
      return scopeStr;
    },
    top() {
      return stack[stack.length - 1]?.name;
    },
    currentLocalId() {
      return stack.length ? stack[stack.length - 1]!.localId : 0;
    },
    finaliseModule(lineEnd) {
      recorded[0]!.line_end = lineEnd;
    },
    getRecorded() {
      return recorded;
    },
  };
}

export const scopesExtractor: TierExtractor = {
  tierId: "scopes",
  register(visitor, ctx) {
    const { scopes } = ctx;
    Object.assign(visitor, {
      MethodDefinition(node: any) {
        const name = node.key?.name;
        if (!name) return;
        // Compute line range here so the row records the method body.
        const lineStart = node.loc?.start?.line ?? 0;
        const lineEnd = node.loc?.end?.line ?? 0;
        scopes.push(name, "method", lineStart, lineEnd);
      },
      "MethodDefinition:exit"(node: any) {
        const name = node.key?.name;
        if (name && scopes.top() === name) {
          scopes.pop();
        }
      },
    });
  },
  finalize(ctx) {
    // Module scope `line_end` finalised here: the orchestrator's line_map
    // length is the line count. We approximate via the highest line we've
    // seen on any row; falling back to 1 if no rows ever pushed.
    const recorded = ctx.scopes.getRecorded();
    let maxLine = 1;
    for (const r of recorded) {
      if (r.line_end > maxLine) maxLine = r.line_end;
    }
    ctx.scopes.finaliseModule(maxLine);
  },
};
