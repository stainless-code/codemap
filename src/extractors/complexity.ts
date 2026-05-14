/**
 * Cyclomatic complexity (McCabe) tracker + extractor. Shared-state pattern:
 * tracker on `ctx.complexity`, mutated by `symbolsExtractor`'s function-shape
 * handlers (push/pop alongside symbol-row emission) AND by
 * `complexityExtractor`'s branching handlers (increment) + fn-expr push-pop.
 *
 * Factory closes over `symbols` so `popTop()` writes the final count back
 * onto the row at the tracked index.
 */

import type { SymbolRow } from "../db";
import type { ComplexityTracker, TierExtractor } from "./types";

export function createComplexityTracker(
  symbols: SymbolRow[],
): ComplexityTracker {
  const stack: { symbolIndex: number; count: number }[] = [];
  const arrowMap = new WeakMap<object, number>();

  return {
    pushFor(symbolIndex) {
      stack.push({ symbolIndex, count: 1 });
    },
    popTop() {
      const top = stack.pop();
      if (!top) return;
      if (top.symbolIndex >= 0) {
        symbols[top.symbolIndex].complexity = top.count;
      }
    },
    increment() {
      const top = stack[stack.length - 1];
      if (top) top.count++;
    },
    markArrowSymbol(node, symbolIndex) {
      arrowMap.set(node, symbolIndex);
    },
    getArrowSymbol(node) {
      return arrowMap.get(node);
    },
  };
}

export const complexityExtractor: TierExtractor = {
  tierId: "complexity",
  register(visitor, ctx) {
    const { complexity } = ctx;
    const inc = () => complexity.increment();

    Object.assign(visitor, {
      // `symbolsExtractor`'s VariableDeclaration populates the arrow
      // WeakMap; anonymous nodes (callbacks, IIFEs) get `-1` → counted
      // but never written back to a symbol row.
      ArrowFunctionExpression(node: any) {
        complexity.pushFor(complexity.getArrowSymbol(node) ?? -1);
      },
      "ArrowFunctionExpression:exit"() {
        complexity.popTop();
      },
      FunctionExpression(node: any) {
        complexity.pushFor(complexity.getArrowSymbol(node) ?? -1);
      },
      "FunctionExpression:exit"() {
        complexity.popTop();
      },

      // Cyclomatic-complexity branching nodes — each adds 1 to the
      // currently-walked function's count. Tracks if/loops/case/catch/&&/||/??/?:.
      IfStatement: inc,
      WhileStatement: inc,
      DoWhileStatement: inc,
      ForStatement: inc,
      ForInStatement: inc,
      ForOfStatement: inc,
      ConditionalExpression: inc, // `a ? b : c`
      CatchClause: inc,
      SwitchCase(node: any) {
        // `default:` is the fall-through arm, not a decision point — only
        // count `case X:` arms.
        if (node.test !== null && node.test !== undefined) {
          complexity.increment();
        }
      },
      LogicalExpression(node: any) {
        // `&&`, `||`, `??` introduce branching paths; `&` / `|` are bitwise
        // (not decision points; AST shapes them as BinaryExpression).
        if (
          node.operator === "&&" ||
          node.operator === "||" ||
          node.operator === "??"
        ) {
          complexity.increment();
        }
      },
    });
  },
};
