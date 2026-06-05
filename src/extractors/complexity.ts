/**
 * Cyclomatic complexity (McCabe) + SonarSource cognitive complexity tracker
 * and extractor. Shared-state pattern: tracker on `ctx.complexity`, mutated by
 * `symbolsExtractor`'s function-shape handlers (push/pop alongside symbol-row
 * emission) AND by `complexityExtractor`'s branching handlers + fn-expr /
 * method push-pop.
 *
 * Factory closes over `symbols` so `popTop()` writes counts back onto the row
 * at the tracked index.
 */

import type { SymbolRow } from "../db";
import type { ComplexityTracker, TierExtractor } from "./types";

interface StackFrame {
  symbolIndex: number;
  count: number;
  currentDepth: number;
  maxDepth: number;
  cognitive: number;
  cognitiveNest: number;
}

export function createComplexityTracker(
  symbols: SymbolRow[],
): ComplexityTracker {
  const stack: StackFrame[] = [];
  const arrowMap = new WeakMap<object, number>();
  return {
    pushFor(symbolIndex) {
      stack.push({
        symbolIndex,
        count: 1,
        currentDepth: 0,
        maxDepth: 0,
        cognitive: 0,
        cognitiveNest: 0,
      });
    },
    popTop() {
      const top = stack.pop();
      if (!top) return;
      if (top.symbolIndex >= 0) {
        symbols[top.symbolIndex].complexity = top.count;
        symbols[top.symbolIndex].nesting_depth = top.maxDepth;
        symbols[top.symbolIndex].cognitive_complexity = top.cognitive;
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
    cognitiveStructural() {
      const top = stack[stack.length - 1];
      if (!top) return;
      top.cognitive += 1 + top.cognitiveNest;
    },
    cognitiveFlat() {
      const top = stack[stack.length - 1];
      if (!top) return;
      top.cognitive += 1;
    },
    enterCognitiveNest() {
      const top = stack[stack.length - 1];
      if (top) top.cognitiveNest++;
    },
    exitCognitiveNest() {
      const top = stack[stack.length - 1];
      if (top && top.cognitiveNest > 0) top.cognitiveNest--;
    },
  };
}

export const complexityExtractor: TierExtractor = {
  tierId: "complexity",
  register(visitor, ctx) {
    const { complexity } = ctx;
    const nest = () => {
      complexity.cognitiveStructural();
      complexity.enterCognitiveNest();
      complexity.enterNest();
      complexity.increment();
    };
    const unnest = () => {
      complexity.exitCognitiveNest();
      complexity.exitNest();
    };

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
      // on enter and decrement on exit. Cognitive uses Sonar structural
      // increments (+1 + nesting) on the same shapes.
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
          complexity.cognitiveFlat();
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
          complexity.cognitiveFlat();
        }
      },
    });
  },
};
