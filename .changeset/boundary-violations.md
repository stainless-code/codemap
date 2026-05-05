---
"@stainless-code/codemap": minor
---

feat(boundaries): config-driven architecture-boundary rules + `boundary-violations` recipe

Adds the smallest substrate for first-class architecture boundary checks. Schema bump 8 → 9.

**Configure**

```ts
import { defineConfig } from "@stainless-code/codemap";

export default defineConfig({
  boundaries: [
    {
      name: "ui-cant-touch-server",
      from_glob: "src/ui/**",
      to_glob: "src/server/**",
    },
  ],
});
```

`action` defaults to `"deny"` (the only shape v1 surfaces); `"allow"` reserves the slot for future whitelist semantics.

**Substrate**

- New config field `boundaries: BoundaryRule[]` on the Zod user-config schema (`src/config.ts`); validated at config-load time.
- New table `boundary_rules(name PK, from_glob, to_glob, action CHECK IN ('deny','allow'))` (`STRICT, WITHOUT ROWID`) — fully derived from config, dropped on `--full` / `SCHEMA_VERSION` rebuilds and re-filled by the next index pass.
- New helper `reconcileBoundaryRules(db, rules)` in `src/db.ts`; called from `runCodemapIndex` after `createSchema` so the table tracks config exactly.
- New runtime accessor `getBoundaryRules()`.

**Recipe**

`templates/recipes/boundary-violations.{sql,md}` joins `dependencies` × `boundary_rules` via SQLite `GLOB` and surfaces violating import edges as locatable rows. `--format sarif` and `--format annotations` light up automatically (the recipe aliases `dependencies.from_path` to `file_path`). Use as a CI gate:

```bash
codemap query --recipe boundary-violations --format sarif > findings.sarif
```

**Lockstep**

- `docs/architecture.md` § Schema gains a `boundary_rules` subsection.
- `docs/glossary.md` adds `boundaries` / `boundary_rules` / `boundary-violations` entry.
- `docs/roadmap.md § Backlog` removes the now-shipped item per Rule 2.
- `templates/agents/rules/codemap.md`, `.agents/rules/codemap.md`, `templates/agents/skills/codemap/SKILL.md`, `.agents/skills/codemap/SKILL.md`, and `README.md` all document the new shape.

**Tests**

`src/application/boundary-rules.test.ts` covers schema creation, idempotent reconciliation, CHECK constraint, and the recipe SQL against a synthetic dependency graph. `src/config.test.ts` covers Zod validation including default-action filling and unknown-action rejection.
