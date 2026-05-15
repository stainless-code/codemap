/**
 * Scope tracker (shared state on `ctx.scopes` per [R.17]) + scopes
 * extractor (pure-scope handlers; symbol-emitting handlers push/pop
 * inline in `symbolsExtractor`). Module scope = `local_id 0`, eagerly
 * inserted; nested pushes increment. See [R.11].
 */

import type { ScopeRow } from "../db";
import { buildJsDocIndex } from "./jsdoc";
import { pushParams, pushTypeParams } from "./params";
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
      line_end: 1, // finalised by `finaliseModule` once the walk completes.
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
      // Skip anonymous scopes (empty-name, e.g. callback arrows) so
      // nested symbols' parent_name still points at the nearest named
      // owner — preserves pre-arrow-scoping semantics for
      // `const foo = () => { const bar = … }` style code.
      for (let i = stack.length - 1; i >= 0; i--) {
        const n = stack[i]!.name;
        if (n) return n;
      }
      return null;
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
    const { scopes, comments, source } = ctx;
    const jsDocComments = buildJsDocIndex(comments);
    Object.assign(visitor, {
      MethodDefinition(node: any) {
        const name = node.key?.name;
        if (!name) return;
        const lineStart = node.loc?.start?.line ?? 0;
        const lineEnd = node.loc?.end?.line ?? 0;
        scopes.push(name, "method", lineStart, lineEnd);
        ctx.claimedScopeNodes.add(node);
        // Method bodies are FunctionExpression — mark them too so the
        // arrow handler doesn't re-push.
        if (node.value) ctx.claimedScopeNodes.add(node.value);
        // Constructor params already emitted as class-scope symbols by
        // symbolsExtractor.ClassDeclaration — skip to avoid duplicates.
        if (node.kind !== "constructor" && node.value?.params?.length) {
          pushTypeParams(
            node.value.typeParameters,
            scopes.currentLocalId(),
            name,
            ctx,
          );
          pushParams(
            node.value.params,
            scopes.currentLocalId(),
            name,
            ctx,
            jsDocComments,
            source,
          );
        }
      },
      "MethodDefinition:exit"(node: any) {
        const name = node.key?.name;
        if (name && scopes.top() === name) {
          scopes.pop();
        }
      },
      // Orphan callback arrows (`arr.map((x) => …)`): push an anonymous
      // scope so params don't collide with the enclosing function's.
      // VariableDeclaration / MethodDefinition / FunctionDeclaration
      // claim their arrows in `claimedScopeNodes` so we don't double-push.
      ArrowFunctionExpression(node: any) {
        if (ctx.claimedScopeNodes.has(node)) return;
        const lineStart = node.loc?.start?.line ?? 0;
        const lineEnd = node.loc?.end?.line ?? 0;
        scopes.push("", "arrow", lineStart, lineEnd);
        if (node.params?.length) {
          pushParams(
            node.params,
            scopes.currentLocalId(),
            null,
            ctx,
            jsDocComments,
            source,
          );
        }
      },
      "ArrowFunctionExpression:exit"(node: any) {
        if (ctx.claimedScopeNodes.has(node)) return;
        if (scopes.top() === "") scopes.pop();
      },
      // `try { … } catch (err) { … }` — `err` is bound in catch body's
      // own scope. Push anonymous scope + emit param so the body refs
      // resolve. Bindingless `catch { … }` (TS 4.4+ optional param) has
      // `param === null` — no symbol needed.
      CatchClause(node: any) {
        scopes.push(
          "",
          "function",
          node.loc?.start?.line ?? 0,
          node.loc?.end?.line ?? 0,
        );
        if (node.param) {
          pushParams(
            [node.param],
            scopes.currentLocalId(),
            null,
            ctx,
            jsDocComments,
            source,
          );
        }
      },
      "CatchClause:exit"() {
        if (scopes.top() === "") scopes.pop();
      },
    });
  },
  finalize(ctx) {
    // Approximate the module's line_end as the max recorded child line —
    // the orchestrator's lineMap length isn't passed to finalize.
    const recorded = ctx.scopes.getRecorded();
    let maxLine = 1;
    for (const r of recorded) {
      if (r.line_end > maxLine) maxLine = r.line_end;
    }
    ctx.scopes.finaliseModule(maxLine);
  },
};
