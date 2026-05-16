Lists `@deprecated` symbols defined in `src/` only — production code, excluding fixtures, tests, and templates. Companion to the bundled `deprecated-symbols` recipe; useful when planning a removal pass and you want to see exactly what production code still carries the tag.

Run via `bun src/index.ts query --recipe src-deprecated`.
