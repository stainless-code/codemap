---
"@stainless-code/codemap": patch
---

`unused-type-members` recipe — field-level enumeration of `type_members` whose owning type has no detectable importer in the project. Sister recipe to `unimported-exports`: same upstream signal at the type level, but JOINed against `type_members` so each row carries the field's name, type annotation, optionality, and readonly flag. Useful when planning a deletion of an interface and you need the full field inventory before drafting the codemod.

**Strictly advisory.** Codemap doesn't track property access, so the recipe inherits all of `unimported-exports`'s false-positive classes plus the per-field opaqueness of indexed access (`T['field']`), `keyof T`, mapped types, type spreads, destructuring, and re-export chains. Output is a STARTING POINT for human review, never a "safe to delete" list. Bundled `.md` documents every caveat and includes tuning axes for project-local overrides.

`unused-type-members` joins the standard recipe taxonomy and ships in `templates/recipes/unused-type-members.{sql,md}`. Reachable as `codemap query --recipe unused-type-members` (or via the `--format sarif` / `--format annotations` / `--ci` aggregate flags); rule id is `codemap.unused-type-members`. Golden-query expectation lives at `fixtures/golden/minimal/unused-type-members.json`. Pure recipe addition — no schema impact, no engine change.
