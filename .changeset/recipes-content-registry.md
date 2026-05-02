---
"@stainless-code/codemap": minor
---

feat(recipes): recipes-as-content registry — bundled .md siblings + project-local recipes

Two complementary capabilities:

1. **Bundled recipes get richer descriptions.** Every bundled recipe in
   `templates/recipes/` is now a `<id>.sql` file paired with an optional
   `<id>.md` description body (replaces the inline TypeScript map in
   `src/cli/query-recipes.ts`). Per-row `actions` templates live in YAML
   frontmatter on the `.md` instead of code. Same surface for end users
   (`--recipe <id>` / `--recipes-json` / `codemap://recipes`); single
   storage shape across bundled + project recipes.

2. **Project-local recipes** — drop `<id>.{sql,md}` files into
   `<projectRoot>/.codemap/recipes/` to ship team-internal SQL as first-
   class recipes. Auto-discovered via `--recipe <id>`, surfaced in
   `--recipes-json` and the `codemap://recipes` MCP resource alongside
   bundled. Project recipes win on id collision; the catalog entry
   carries `shadows: true` on overrides so agents reading the catalog
   at session start see when a recipe behaves differently from the
   documented bundled version (per-execution response shape stays
   unchanged — uniformity contract preserved).

Catalog entries (`--recipes-json` output, `codemap://recipes`
payload) gain three additive fields: `body` (full Markdown body),
`source` (`"bundled" | "project"`), and `shadows?` (true on
project entries that override a bundled id). Existing consumers
that destructure `{id, description, sql, actions?}` keep working.

Validation: load-time lexical scan rejects DML / DDL keywords
(`INSERT` / `UPDATE` / `DELETE` / `DROP` / `CREATE` / `ALTER` /
`ATTACH` / `DETACH` / `REPLACE` / `TRUNCATE` / `VACUUM` / `PRAGMA`)
in recipe SQL with recipe-aware error messages — defence in depth
alongside the runtime `PRAGMA query_only=1` backstop in
`query-engine.ts` shipped in the previous release.

Implementation: pure transport-agnostic loader in
`src/application/recipes-loader.ts`; thin shim in
`src/cli/query-recipes.ts` preserves backwards-compat exports
(`QUERY_RECIPES`, `getQueryRecipeSql`, etc.). Hand-rolled YAML
frontmatter parser scoped to the `actions` shape (no `js-yaml`
dependency).

`.codemap.db` is gitignored as before; `.codemap/recipes/` is NOT
(verified via `git check-ignore`) — recipes are git-tracked source
code authored for human review.
