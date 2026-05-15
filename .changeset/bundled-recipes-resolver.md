---
"@stainless-code/codemap": patch
---

Fix `resolveBundledRecipesDir()` path resolution — the 40 bundled recipes were unreachable at runtime in 0.6.0's published artifact. The resolver had one extra `..` segment relative to where the bundler emits the dist chunk; `bunx codemap query --recipes-json` returned `[]` and `bunx codemap query --recipe <id>` rejected every bundled id with `unknown recipe`.

The fix derives the bundled-recipes path off `resolveAgentsTemplateDir()` (same pattern used by `resolveAgentContentDir()`) so a single resolver handles both source-mode (`bun src/index.ts`) and dist-mode (`node dist/index.mjs`) without environment-specific branching — every chunk lands flat in `dist/` regardless of the source file's nested depth.

Discovered by a downstream consumer immediately after `bun install @stainless-code/codemap@0.6.0`. Regression guard: new `src/application/query-recipes.dist.test.ts` asserts `existsSync(resolveBundledRecipesDir())` + catalog populates; CI gains a `node dist/index.mjs query --recipes-json` smoke step that exits non-zero on an empty catalog.
