---
actions:
  - type: review-boundary-violation
    description: "Either move the import to satisfy the rule, broaden the rule, or document the exception. Codemap never auto-fixes."
---

# Boundary violations

Surfaces resolved import edges from `dependencies` that match a `deny` rule declared under `boundaries:` in `.codemap/config.ts`. Each row is one violation: a `from_path` file (matching `rule_from_glob`) imports a `to_path` file (matching `rule_to_glob`).

## Configure

`.codemap/config.ts`:

```ts
import { defineConfig } from "@stainless-code/codemap";

export default defineConfig({
  boundaries: [
    {
      name: "ui-cant-touch-server",
      from_glob: "src/ui/**",
      to_glob: "src/server/**",
      action: "deny",
    },
  ],
});
```

The shape lives in the Zod config schema (`src/config.ts` `boundaries`); fields validate at config-load time. `action` defaults to `"deny"` — `"allow"` is reserved for future whitelist semantics and is currently a no-op.

## Use

```bash
codemap query --recipe boundary-violations --json
codemap query --recipe boundary-violations --format sarif > findings.sarif
codemap query --recipe boundary-violations --format annotations
```

SARIF / annotations consume the `file_path` location column (the `from_path` of the violating import) and emit one finding per row. SARIF rule id is `codemap.boundary-violations` (the per-rule `name` is in the row body via the `rule_name` field).

## What v1 covers

- Resolved import edges in the `dependencies` table.
- SQLite `GLOB` matching — `*`, `?`, `[abc]`. **Important:** SQLite's `*` is not filesystem-aware — it matches any sequence of characters **including `/`**, so `src/ui/*` matches everything under `src/ui/` at any depth (`src/ui/Button.tsx`, `src/ui/forms/Input.tsx`, `src/ui/forms/internal/util.ts`, …). To restrict a rule to a single path segment, use a character class that excludes `/` — e.g. `src/ui/[^/]*` or `src/ui/[^/]*.tsx`. There is no `**` glob in SQLite; depth is controlled with explicit segment patterns.

## What v1 does not cover

- Bare specifiers that don't resolve to a project file (`import x from "lodash"`) — those don't appear in `dependencies` at all.
- Type-only imports (`import type { X }`) appear in `imports.is_type_only` but not in `dependencies` (no resolved edge); deliberate to avoid noise on type-only crossings.
- Layer ordering, element-type rules, "allow within own glob" sugar — current shape is two-glob deny lists. Promote to richer shapes only when a real recipe demands it.
