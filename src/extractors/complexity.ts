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
  const stack: {
    symbolIndex: number;
    count: number;
    currentDepth: number;
    maxDepth: number;
  }[] = [];
  const arrowMap = new WeakMap<object, number>();

  return {
    pushFor(symbolIndex) {
      stack.push({ symbolIndex, count: 1, currentDepth: 0, maxDepth: 0 });
    },
    popTop() {
      const top = stack.pop();
      if (!top) return;
      if (top.symbolIndex >= 0) {
        symbols[top.symbolIndex].complexity = top.count;
        symbols[top.symbolIndex].nesting_depth = top.maxDepth;
      }
    },
    increment() {
      const top = stack[stack.length - 1];
      if (top) top.count++;
    },
    enterNest() {
      const top = stack[stack.length - 1];
      if (!top) return;
      top.currentDepth++;
      if (top.currentDepth > top.maxDepth) top.maxDepth = top.currentDepth;
    },
    exitNest() {
      const top = stack[stack.length - 1];
      if (top && top.currentDepth > 0) top.currentDepth--;
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
    const nest = () => {
      complexity.enterNest();
      complexity.increment();
    };
    const unnest = () => complexity.exitNest();

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

      // Cyclomatic-complexity branching nodes — each adds 1. Block-bearing
      // forms (if/for/while/try/ternary) ALSO increment nesting_depth
      // on enter and decrement on exit.
      IfStatement: nest,
      "IfStatement:exit": unnest,
      WhileStatement: nest,
      "WhileStatement:exit": unnest,
      DoWhileStatement: nest,
      "DoWhileStatement:exit": unnest,
      ForStatement: nest,
      "ForStatement:exit": unnest,
      ForInStatement: nest,
      "ForInStatement:exit": unnest,
      ForOfStatement: nest,
      "ForOfStatement:exit": unnest,
      ConditionalExpression: nest, // `a ? b : c`
      "ConditionalExpression:exit": unnest,
      CatchClause: nest,
      "CatchClause:exit": unnest,
      SwitchCase(node: any) {
        // `default:` is the fall-through arm, not a decision point — only
        // count `case X:` arms. SwitchCase is a child of SwitchStatement;
        // we count the cases, not the switch wrapper, for cyclomatic. No
        // nesting bump (switch arms are sibling, not depth).
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
