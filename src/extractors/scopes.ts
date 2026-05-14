/**
 * Scope tracker + scopes extractor. Shared-state pattern per [R.17]:
 * tracker lives on `ctx.scopes`; mutated by any extractor whose handler
 * needs to push / pop scope.
 *
 * `scopesExtractor` owns only pure-scope handlers (`MethodDefinition` /
 * `:exit`). Handlers that interleave scope mutation with row emission
 * (`symbolsExtractor`'s FunctionDeclaration / VariableDeclaration /
 * ClassDeclaration) call `scopes.push/pop` inline so observable
 * read/push ordering matches the pre-lift implementation.
 */

import type { ScopeTracker, TierExtractor } from "./types";

export function createScopeTracker(): ScopeTracker {
  const stack: string[] = [];
  let scopeStr = "";

  return {
    push(name: string) {
      stack.push(name);
      scopeStr = scopeStr ? `${scopeStr}.${name}` : name;
    },
    pop() {
      stack.pop();
      scopeStr = stack.join(".");
    },
    currentParent() {
      return stack.length ? stack[stack.length - 1] : null;
    },
    currentScope() {
      return scopeStr;
    },
    top() {
      return stack[stack.length - 1];
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
        if (name) scopes.push(name);
      },
      "MethodDefinition:exit"(node: any) {
        const name = node.key?.name;
        if (name && scopes.top() === name) {
          scopes.pop();
        }
      },
    });
  },
};
