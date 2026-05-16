---
"@stainless-code/codemap": patch
---

**Fix: project recipes (`<root>/.codemap/recipes/<id>.sql`) are now visible via the CLI.**

`parseQueryRest` validates `--recipe <id>` / `--recipes-json` / `--print-sql <id>` BEFORE `runQueryCmd` calls `bootstrapCodemap`, so the recipe registry hit `getProjectRoot()` pre-init, the throw was silently caught, and the loader fell back to bundled-only. The MCP and HTTP transports always bootstrap before reaching the loader, so project recipes worked there throughout — only the CLI path was affected.

Fix is surgical:

- New `setQueryRecipesProjectRoot(root)` API in `application/query-recipes.ts` — caller-supplied root takes precedence over the runtime config (which isn't initialised yet during argv parse).
- `cli/main.ts` calls it once right after `parseBootstrapArgs` returns `root`, so every subsequent verb (parser-side and post-bootstrap) sees the same value.

Single source of truth: the override is the same root `bootstrapCodemap` resolves to — no parallel walk-up heuristic, no new env var, no second resolution path. The registry cache invalidates when the override changes.

Adds regression tests (`query-recipes.pre-bootstrap.test.ts`) exercising the override-only path (no `initCodemap`) plus a dogfood project recipe (`.codemap/recipes/src-deprecated.sql`) that scopes the bundled `deprecated-symbols` audit to `src/` only — useful for codemap's own deprecation lifecycle, and a permanent regression case against this bug recurring.

Consumers with project recipes authored on 0.6.x–0.7.2 didn't need to wait — recipes worked via MCP / HTTP throughout. After upgrading, the CLI auto-picks them up.
