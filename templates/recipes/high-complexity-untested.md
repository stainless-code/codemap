---
actions:
  - type: review-test-coverage
    auto_fixable: false
    description: "High-complexity function with low coverage — many decision points (if / loops / case / && / || / ?:) AND nobody's exercising them. Add tests before refactoring; bugs on edit are likely."
---

Functions with cyclomatic complexity `≥ 10` AND measured coverage `< 50%`. Combines two evidence axes — structural (complexity) and runtime (coverage) — to surface refactor-priority candidates that the single-axis recipes (`untested-and-dead`, `worst-covered-exports`) miss because they're "called but undertested."

## Cyclomatic complexity (per `symbols.complexity`)

McCabe formula: `1 + (decision points)`. Branching nodes counted by Codemap's parser walker:

- `if` / `while` / `do…while` / `for` / `for…in` / `for…of`
- `case X:` arms inside `switch` (the `default:` fall-through is **not** counted — it's not a decision point)
- `&&` / `||` / `??` short-circuit operators (`?` / `:` ternary too)
- `catch` clauses

**Computed for function-shaped symbols** — top-level `function` declarations, named arrow/const bindings, and class methods (`MethodDefinition` bodies). Non-function kinds (interfaces, types, enums, plain consts) get `complexity = NULL` and are excluded by `WHERE s.complexity IS NOT NULL`.

## Cognitive complexity column (`symbols.cognitive_complexity`)

Each row also includes **SonarSource cognitive complexity** for the same symbol (nesting-heavy control flow scores higher than flat branch chains). The recipe **filter** still uses cyclomatic `>= 10`; use `high-cognitive-complexity` when cognitive score alone is the gate.

## Why the joint signal

- High complexity alone surfaces too many false positives — a heavily-branched config-loader or visitor pattern is fine if it's well-tested.
- Low coverage alone surfaces too many false positives — a one-line getter with 0% coverage is barely worth testing.
- The intersection is the actionable list: _complex code that nobody's exercising = bug magnet_.

## Tuning axes for project-local overrides

`<state-dir>/recipes/high-complexity-untested.sql` (default `.codemap/recipes/`):

- **Complexity threshold**: change `>= 10` to project's risk-appetite (5 for strict; 15 for tolerant).
- **Coverage threshold**: change `< 50` to project's risk-appetite (`< 80` for strict).
- **Filter to a directory**: `AND s.file_path LIKE 'src/api/%'` to scope.
- **Sort by cognitive instead of cyclomatic**: `ORDER BY s.cognitive_complexity DESC` in a project-local recipe override.
