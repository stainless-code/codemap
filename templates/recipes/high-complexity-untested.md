---
actions:
  - type: review-test-coverage
    auto_fixable: false
    description: "High-complexity function with low coverage — many decision points (if / loops / case / && / || / ?:) AND nobody's exercising them. Add tests before refactoring; bugs on edit are likely."
---

Functions with cyclomatic complexity `≥ 10` AND measured coverage `< 50%`. Combines two evidence axes — structural (complexity) and runtime (coverage) — to surface refactor-priority candidates that the single-axis recipes (`untested-and-dead`, `worst-covered-exports`) miss because they're "called but undertested."

## Cyclomatic complexity (per `symbols.complexity`)

McCabe formula: `1 + (decision points)`. Branching nodes counted by codemap's parser walker (`src/parser.ts`):

- `if` / `while` / `do…while` / `for` / `for…in` / `for…of`
- `case X:` arms inside `switch` (the `default:` fall-through is **not** counted — it's not a decision point)
- `&&` / `||` / `??` short-circuit operators (`?` / `:` ternary too)
- `catch` clauses

**Computed for function-shaped symbols only** — non-function kinds (interfaces, types, enums, plain consts) and class member methods get `complexity = NULL` and are excluded by `WHERE s.complexity IS NOT NULL`.

## Why the joint signal

- High complexity alone surfaces too many false positives — a heavily-branched config-loader or visitor pattern is fine if it's well-tested.
- Low coverage alone surfaces too many false positives — a one-line getter with 0% coverage is barely worth testing.
- The intersection is the actionable list: _complex code that nobody's exercising = bug magnet_.

## Tuning axes for project-local overrides

`<projectRoot>/.codemap/recipes/high-complexity-untested.sql`:

- **Complexity threshold**: change `>= 10` to project's risk-appetite (5 for strict; 15 for tolerant).
- **Coverage threshold**: change `< 50` to project's risk-appetite (`< 80` for strict).
- **Filter to a directory**: `AND s.file_path LIKE 'src/api/%'` to scope.
- **Include class members**: complexity is computed per top-level function; class methods currently inherit `null` (see "v1 limitation" below).

## v1 limitation — class methods are NULL

Complexity is currently computed for top-level `function` declarations and arrow-function consts. Class methods (`MethodDefinition`) follow the same shape but don't push to the complexity stack yet. Refactor the `MethodDefinition` visitor in `src/parser.ts` to call `pushComplexityFor` / `popComplexityInto` if class-heavy projects need this.
