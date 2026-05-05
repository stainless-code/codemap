---
actions:
  - type: review-for-deletion
    auto_fixable: false
    description: "Member of an EXPORTED type that has no detectable importer. STARTING POINT for review only — codemap cannot see indexed access (T['field']), keyof T, mapped types, type spreads, destructuring, or re-export chains. Cross-check with rg before deleting."
---

Field-level enumeration of types that are **exported but never directly imported** anywhere in the project. Sister recipe to [`unimported-exports`](./unimported-exports.md): same upstream signal (`exports.name NOT IN imports.specifiers`), but JOINed against `type_members` so each row carries the field's name, type annotation, optionality, and readonly flag.

## When to reach for it

- Planning a deletion of an interface or type alias and need the full field inventory before drafting the codemod.
- Auditing a published API surface — which exported types carry fields that consumers don't reference?
- Cross-checking `rename-preview` — if `rename-preview` finds zero call sites for a symbol, this recipe's parent type is a candidate too.

## When NOT to reach for it

- "Find unused fields on a type that IS imported." Codemap does not track property access — there's no substrate for this question. False-positive rate would be near 100%.
- "Safe-to-delete list." Treat every row as a candidate worth a `rg <member>` pass before any deletion.

## Substrate caveats (codemap can't see)

The recipe inherits all the false-positive classes of `unimported-exports`, **plus** the fact that interface fields can be referenced indirectly through several TypeScript constructs codemap doesn't model:

| Pattern                                                             | Why it's invisible                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Indexed access — `T['baseUrl']`                                     | String-key lookup; the field name is in a string literal, not a name reference.                |
| `keyof T` / mapped types — `{ [K in keyof T]: U }`                  | Members are used as a set; no per-field reference.                                             |
| Type spreads — `interface U extends T {}`, `type U = T & {…}`       | Members propagate without per-field mention.                                                   |
| Destructuring — `function f({ baseUrl }: ClientConfig)`             | Property access; codemap's `calls` table tracks function calls, not property reads.            |
| Re-export chains — barrel `export { ClientConfig } from './client'` | Same gap as `unimported-exports`; recursive CTE walking `re_export_source` is a future recipe. |
| `tsconfig.json` path aliases                                        | When `imports.resolved_path IS NULL` the row is excluded; common with unusual config.          |
| Default exports                                                     | Excluded (`e.is_default = 0`) — high false-positive class on framework entry points.           |

## Tuning axes for project-local overrides

- **Scope to a directory** — add `AND tm.file_path LIKE 'src/lib/%'` to narrow the audit to a single owner / package.
- **Filter to optional fields** — add `AND tm.is_optional = 1` to surface candidates whose absence wouldn't break compilation.
- **Filter to readonly fields** — add `AND tm.is_readonly = 1` to surface immutable contract surface.
- **Exclude conventional public-API types** — add `AND tm.symbol_name NOT LIKE '%Props' AND tm.symbol_name NOT LIKE '%Config'` if your codebase treats those suffixes as deliberate consumer surface.

## What's NOT covered (orthogonal recipes)

- **Re-export chain following** — same gap as `unimported-exports`; tracked in research notes.
- **Property-access tracking** — would require a new substrate column on `calls` or a separate `property_reads` table; not on the v1 roadmap.
- **Component prop usage** — for React props, [`components-by-hooks`](./components-by-hooks.md) gives hook usage; per-prop reference is the same property-access gap.
