/**
 * Component detector + extractor. Detects React-shaped functions
 * (PascalCase name in `.tsx`/`.jsx`); decides at function-exit whether
 * to push a `ComponentRow`. `symbolsExtractor`'s enter handlers signal
 * candidate scopes via `detector.enter(name)`; this extractor owns the
 * JSX handlers + hook-detection CallExpression + exit handlers.
 *
 * Registered AFTER `symbolsExtractor` so its symbol-row push runs first.
 * Chained with `callsExtractor` on CallExpression.
 */

import type { TierExtractor } from "./types";

const RE_COMPONENT = /^[A-Z]/;
const RE_HOOK = /^use[A-Z]/;

export function createComponentDetector() {
  const hookCalls = new Map<string, string[]>(); // scope name → hooks (insertion-ordered)
  const jsxScopes = new Set<string>();
  // Stack so `function Outer() { function Inner() {…} }` keeps Outer's
  // attribution after Inner exits.
  const stack: string[] = [];

  return {
    enter(name: string) {
      stack.push(name);
      if (!hookCalls.has(name)) hookCalls.set(name, []);
    },
    current() {
      return stack.length ? stack[stack.length - 1]! : null;
    },
    exit() {
      stack.pop();
    },
    markJsx() {
      const top = stack[stack.length - 1];
      if (top) jsxScopes.add(top);
    },
    recordHook(hookName: string) {
      const top = stack[stack.length - 1];
      if (!top) return;
      const list = hookCalls.get(top);
      if (list && !list.includes(hookName)) list.push(hookName);
    },
    hasJsxOrHooks(name: string) {
      if (jsxScopes.has(name)) return true;
      const hooks = hookCalls.get(name);
      return hooks !== undefined && hooks.length > 0;
    },
    hooksFor(name: string) {
      return hookCalls.get(name) ?? [];
    },
  };
}

// Exposed for `symbolsExtractor`'s enter handlers — they call
// `detector.enter(name)` when this returns true.
export function isComponentCandidate(name: string, isTsx: boolean): boolean {
  return isTsx && RE_COMPONENT.test(name);
}

export function isHookCall(name: string): boolean {
  return RE_HOOK.test(name);
}

export const componentsExtractor: TierExtractor = {
  tierId: "components",
  register(visitor, ctx) {
    const { componentDetector, components, relPath, isTsx } = ctx;

    function maybeAddComponent(name: string, fnNode: any) {
      if (!isTsx || !RE_COMPONENT.test(name)) return;
      if (!componentDetector.hasJsxOrHooks(name)) return;

      const hooks = componentDetector.hooksFor(name);
      const isDefault = ctx.defaultExportedNames.has(name);

      let propsType: string | null = null;
      const params = fnNode?.params;
      if (params?.length > 0) {
        const firstParam = params[0];
        if (firstParam.typeAnnotation?.typeAnnotation) {
          const ta = firstParam.typeAnnotation.typeAnnotation;
          if (ta.type === "TSTypeReference" && ta.typeName?.name) {
            propsType = ta.typeName.name;
          }
        }
      }

      components.push({
        file_path: relPath,
        name,
        props_type: propsType,
        hooks_used: JSON.stringify(hooks),
        is_default_export: isDefault ? 1 : 0,
      });
    }

    Object.assign(visitor, {
      JSXElement() {
        componentDetector.markJsx();
      },
      JSXFragment() {
        componentDetector.markJsx();
      },

      // Hook detection: chained with `callsExtractor`'s CallExpression.
      CallExpression(node: any) {
        if (!componentDetector.current()) return;
        const callee = node.callee;
        if (callee?.type === "Identifier" && RE_HOOK.test(callee.name)) {
          componentDetector.recordHook(callee.name);
        }
      },

      "FunctionDeclaration:exit"(node: any) {
        const name = node.id?.name;
        if (name && componentDetector.current() === name) {
          maybeAddComponent(name, node);
          componentDetector.exit();
        }
      },
      "VariableDeclaration:exit"(node: any) {
        // Reverse iteration matches `symbolsExtractor`'s scope-pop order
        // for multi-declarator `const A = () => …, B = () => …`.
        const decls = node.declarations;
        for (let i = decls.length - 1; i >= 0; i--) {
          const decl = decls[i];
          const name = decl.id?.name;
          if (!name) continue;
          if (componentDetector.current() === name) {
            maybeAddComponent(name, decl.init);
            componentDetector.exit();
          }
        }
      },
    });
  },
};
