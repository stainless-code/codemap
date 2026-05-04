---
"@stainless-code/codemap": patch
---

feat(complexity): cyclomatic complexity column on `symbols` + bundled recipe (research note § 1.4 ship-pick (c))

Adds per-function cyclomatic complexity computed during AST walking. Schema bump `SCHEMA_VERSION` 7 → 8 — first reindex after upgrade triggers a full rebuild via the existing version-mismatch path.

**What lands:**

- New `complexity REAL` column on `symbols`. Computed via McCabe formula (`1 + decision points`) for function-shaped symbols (top-level `function` declarations + arrow-function consts). `NULL` for non-functions (interfaces, types, enums, plain consts) and class methods (v1 limitation; documented in the recipe `.md`).
- Decision points counted: `if`, `while`, `do…while`, `for`, `for…in`, `for…of`, `case X:` arms (not `default:` fall-through), `&&` / `||` / `??` short-circuit operators, `?:` ternary, `catch` clauses.
- New bundled recipe `high-complexity-untested` — function-shaped symbols with complexity ≥ 10 AND measured coverage < 50%. Combines structural + runtime evidence axes; surfaces refactor-priority candidates that single-axis recipes (`untested-and-dead`, `worst-covered-exports`) miss because they're "called but undertested."

**Implementation:**

- Parser visitor (`src/parser.ts`) maintains a `complexityStack` keyed by symbol index. On function entry, pushes counter at 1 + symbol index. Branching-node visitors increment the top counter. On function exit, pops and writes complexity into the symbol row already pushed during entry.
- Nested function declarations get their own stack entries — inner branches don't count toward the outer function. (Standard McCabe — each function counted independently.)

**Pre-v1 patch** per `.agents/lessons.md` "changesets bump policy": schema-bumping changes are minor in semver but pre-v1 we default to patch unless the bump forces a `.codemap.db` rebuild. This one does (column added; auto-detected by `createSchema()` mismatch path) — every consumer's first run after upgrade re-indexes from scratch.

Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill mention the `complexity` column, the new recipe, and the cyclomatic-complexity definition.

**Out of scope:**

- **Class method complexity** — `MethodDefinition` visitor currently doesn't push to the complexity stack. Documented in `high-complexity-untested.md` v1 limitation; refactor opportunity for class-heavy projects.
- **Per-class / per-file rollups** — `complexity` is per-symbol; project-local recipes can `SUM` / `AVG` it as needed.
