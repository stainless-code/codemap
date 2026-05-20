/**
 * Module-level side effects — top-level calls and assignments.
 */

import type { TierExtractor } from "./types";

export const moduleSideEffectsExtractor: TierExtractor = {
  tierId: "module-side-effects",
  register(visitor, ctx) {
    const { scopes } = ctx;

    Object.assign(visitor, {
      CallExpression() {
        if (!scopes.currentParent()) ctx.moduleHasSideEffects = true;
      },
      AssignmentExpression() {
        if (!scopes.currentParent()) ctx.moduleHasSideEffects = true;
      },
    });
  },
};
