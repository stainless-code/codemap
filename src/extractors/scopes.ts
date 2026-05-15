/**
 * Scope tracker (shared state on `ctx.scopes` per [R.17]) + scopes
 * extractor (pure-scope handlers; symbol-emitting handlers push/pop
 * inline in `symbolsExtractor`). Module scope = `local_id 0`, eagerly
 * inserted; nested pushes increment. See [R.11].
 */

import type { ScopeRow } from "../db";
import { buildJsDocIndex } from "./jsdoc";
import { pushDestructuredVars, pushParams, pushTypeParams } from "./params";
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
      // `try { … } catch (err) { … }` — `err` is bound in the catch
      // body's own scope. Bindingless `catch { … }` (TS 4.4+) has no
      // param, no symbol needed.
      CatchClause(node: any) {
        scopes.push(
          "",
          "catch",
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
      // Generic / type-param-bearing types: push a scope so type-params
      // resolve via the standard walk inside the body. Symbol row for
      // the interface itself was emitted by symbolsExtractor at the
      // parent scope (ran first per the EXTRACTORS array order).
      TSInterfaceDeclaration(node: any) {
        const name = node.id?.name ?? "";
        scopes.push(
          name,
          "interface",
          node.loc?.start?.line ?? 0,
          node.loc?.end?.line ?? 0,
        );
        ctx.claimedScopeNodes.add(node);
        pushTypeParams(node.typeParameters, scopes.currentLocalId(), name, ctx);
      },
      "TSInterfaceDeclaration:exit"(node: any) {
        const name = node.id?.name;
        if (name && scopes.top() === name) scopes.pop();
        else if (!name && scopes.top() === "") scopes.pop();
      },
      TSTypeAliasDeclaration(node: any) {
        const name = node.id?.name ?? "";
        scopes.push(
          name,
          "type-alias",
          node.loc?.start?.line ?? 0,
          node.loc?.end?.line ?? 0,
        );
        ctx.claimedScopeNodes.add(node);
        pushTypeParams(node.typeParameters, scopes.currentLocalId(), name, ctx);
      },
      "TSTypeAliasDeclaration:exit"(node: any) {
        const name = node.id?.name;
        if (name && scopes.top() === name) scopes.pop();
        else if (!name && scopes.top() === "") scopes.pop();
      },
      // `for (const x of …)` / `for (const x in …)` — `x` is bound in
      // the for body's own scope. ForStatement (C-style) deferred — its
      // init is a regular VariableDeclaration already handled.
      ForOfStatement(node: any) {
        pushForScope(node);
      },
      "ForOfStatement:exit"() {
        if (scopes.top() === "") scopes.pop();
      },
      ForInStatement(node: any) {
        pushForScope(node);
      },
      "ForInStatement:exit"() {
        if (scopes.top() === "") scopes.pop();
      },
    });

    function pushForScope(node: any) {
      scopes.push(
        "",
        "for",
        node.loc?.start?.line ?? 0,
        node.loc?.end?.line ?? 0,
      );
      const left = node.left;
      // VariableDeclaration form: `for (const x of …)` — emit each leaf
      // as a binding at the for-scope. Identifier form: `for (x of …)`
      // is reassignment, not a new binding — skip.
      if (left?.type === "VariableDeclaration") {
        for (const decl of left.declarations ?? []) {
          if (decl.id?.type === "Identifier") {
            pushParams(
              [decl.id],
              scopes.currentLocalId(),
              null,
              ctx,
              jsDocComments,
              source,
            );
          } else if (
            decl.id?.type === "ObjectPattern" ||
            decl.id?.type === "ArrayPattern"
          ) {
            pushDestructuredVars(decl.id, scopes.currentLocalId(), null, ctx);
          }
        }
      }
    }
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
