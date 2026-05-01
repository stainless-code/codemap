## Plan — `recipes-content-registry`

> Pair every bundled recipe with a sibling `.md` description (when-to-use / follow-up SQL hints), and let projects ship their own recipes via `.codemap/recipes/<id>.{sql,md}` files — surfaces uniformly in `--recipes-json`, `codemap query --recipe <id>`, and the `codemap://recipes` MCP resource.
>
> Adopted from [`docs/roadmap.md` § Backlog](../roadmap.md#backlog) ("Recipes-as-content registry"). Builds on the bundled recipe surface (PR [#26](https://github.com/stainless-code/codemap/pull/26)) and the MCP resources shipped in PR [#35](https://github.com/stainless-code/codemap/pull/35).

**Status:** Open — design pass; not yet implemented.
**Cross-refs:** [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage) (recipes are part of the query surface), [`docs/architecture.md` § MCP wiring](../architecture.md#cli-usage) (`codemap://recipes` resource), [`.agents/lessons.md`](../../.agents/lessons.md) (changesets policy: pre-v1 patch unless schema-breaks).

---

## 1. Goal

**Two consumers, one registry.**

- **Bundled recipes today** live in `src/cli/query-recipes.ts` as a TypeScript object map. SQL + short description + optional `actions` are all in code. Description is a one-liner — there's no room for "when to use this", "follow-up SQL", or "what to do with the rows."
- **Project teams today** can't ship a custom recipe without forking codemap or wrapping `codemap query --json "<SQL>"` in their own scripts. There's no on-ramp for "every team member can run `codemap query --recipe internal-flaky-tests` without remembering the SQL."

After v1:

```bash
# bundled recipe — long-form description in sibling .md
codemap query --json --recipe fan-out

# project-local recipe loaded from .codemap/recipes/internal-flaky-tests.sql
codemap query --json --recipe internal-flaky-tests

# catalog surfaces both
codemap query --recipes-json
# MCP resource surfaces both
read_resource codemap://recipes
```

The wins:

- **Bundled recipes get room to teach.** The one-liner becomes a Markdown body with usage notes, follow-up queries, and "what an agent should do with these rows."
- **Project teams ship internal SQL** without forking. `git`-tracked, code-reviewable, no plugin API needed.
- **MCP / agent surface stays uniform** — `codemap://recipes` and `codemap://recipes/{id}` automatically include project-local recipes; agents discover them at session-start.

## 2. Scope split (this plan vs follow-ups)

| Slice                                                                                                                 | Status                                    | Where it lives                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| **A. Project-local recipes** (`.codemap/recipes/<id>.sql`) — actually-new capability                                  | This plan (v1)                            | New loader + composes with existing CLI / MCP surfaces              |
| **B. Bundled recipe extraction** (move `QUERY_RECIPES` map → `templates/recipes/<id>.{sql,md}` files) — pure refactor | This plan (v1)                            | Same loader; bundled recipes become the same shape as project-local |
| **C. Sibling `.md` description body** for both bundled AND project-local                                              | This plan (v1)                            | Optional file alongside `<id>.sql`                                  |
| **D. `actions` support for project-local recipes**                                                                    | Open question (§ 12) — likely v1 if cheap | YAML frontmatter on `<id>.md`? Sibling `<id>.actions.json`?         |
| **E. Recipe versioning / migrations**                                                                                 | v1.x                                      | Out of scope for v1 — defer until two consumers ask                 |
| **F. Recipe parameters** (`{table}`, `{limit}` placeholders)                                                          | v1.x                                      | Out of scope — would require a templating layer                     |

Slices A + B + C ship together because B is pre-requisite for C (uniform loader needs uniform storage), and A is the actual user-facing capability. D depends on grill round.

## 3. Storage layout

### 3.1 Bundled recipes (after refactor)

```
templates/recipes/
├── fan-out.sql               # the SQL string
├── fan-out.md                # description body (optional but recommended)
├── fan-out-sample.sql
├── fan-out-sample.md
├── deprecated-symbols.sql
├── deprecated-symbols.md
├── visibility-tags.sql
├── visibility-tags.md
└── …
```

Each `.sql` is the recipe's SQL verbatim (one statement, no `;` terminator needed). The matching `.md` is optional — when absent, the recipe still loads but has no long-form description (CLI / MCP surfaces show only the recipe id).

`templates/recipes/` ships in the npm package alongside `templates/agents/` (already part of the published artifact — `agents-init.ts`'s `resolveAgentsTemplateDir()` shows the pattern).

### 3.2 Project-local recipes

```
<projectRoot>/
└── .codemap/
    └── recipes/
        ├── internal-flaky-tests.sql
        ├── internal-flaky-tests.md
        └── owner-fanout.sql
```

`<projectRoot>` is the same root the CLI's `--root` / `CODEMAP_ROOT` resolves to. `.codemap/` is the conventional location for codemap-related project artifacts — same parent as a future user-config might use.

### 3.3 Single-file form (rejected for v1)

YAML-frontmatter Markdown with the SQL in a code block (Astro / Hugo style) was considered:

````markdown
---
id: fan-out
description: Top 10 files by dependency fan-out
actions:
  - type: review-coupling
    description: …
---

When to use: …

Follow-up SQL: …

```sql
SELECT from_path, COUNT(*) AS deps FROM dependencies …
```
````

````

**Rejected because:**
- Editor support for SQL inside Markdown code blocks is worse than for `.sql` files (no syntax highlighting, no LSP).
- Two-file split keeps SQL editable as SQL (works with sqlite CLI: `sqlite3 .codemap.db ".read .codemap/recipes/foo.sql"`).
- The frontmatter parsing surface (gray-matter or hand-rolled) is more code than a sibling `.md` lookup.
- One-file form remains a v1.x option if real consumer demand emerges.

## 4. Loader contract

A pure function in `src/application/recipes-loader.ts`:

```typescript
interface LoadedRecipe {
  id: string;
  sql: string;
  description: string | undefined;       // first-line of .md, or undefined
  body: string | undefined;              // full .md body, or undefined
  actions: RecipeAction[] | undefined;   // from YAML frontmatter on .md (D — open question)
  source: "bundled" | "project";         // for catalog disambiguation
}

export function loadAllRecipes(opts: {
  bundledDir: string;       // resolveBundledRecipesDir() — npm package layout
  projectDir: string | undefined;  // resolveProjectRecipesDir(root) — undefined if .codemap/recipes/ is absent
}): LoadedRecipe[];
````

**Conflict resolution:** if a project recipe has the same `id` as a bundled recipe, the **project recipe wins** (`source: "project"`); the bundled one is shadowed but still discoverable via a hypothetical future `--source bundled` filter (out of scope for v1). User-code-wins is the standard convention (npm, ESLint plugins, etc.).

**Validation:** at load time, each `.sql` must parse as something `bun:sqlite`'s `.prepare()` accepts — but we don't actually prepare against a DB until `--recipe <id>` runs (would require an indexed project at load time). v1 does a cheap lexical sanity check: non-empty after stripping `--` line comments and trailing whitespace. SQL errors surface at query-time with the same `enrichQueryError` pretty-printing as ad-hoc SQL.

**Loading time:** **eager at startup**, but cheap. `templates/recipes/` is filesystem-stable per-version (read once). `.codemap/recipes/` is filesystem-stable per-session (the user isn't editing recipes mid-CLI-call). Cache the result in a module-level variable; invalidate only on process restart.

## 5. CLI surface (no new flags — same shape as today)

```bash
codemap query --recipe <id>             # works for bundled OR project recipes; project wins on conflict
codemap query --recipes-json            # full catalog: bundled + project, with `source` field
codemap query --print-sql <id>          # prints the SQL of <id> regardless of source
```

`--recipes-json` output gets two new fields per recipe:

```json
[
  {
    "id": "fan-out",
    "description": "Top 10 files by dependency fan-out",
    "body": "# Fan-out\n\nWhen to use: …\n\nFollow-up SQL: …",
    "sql": "SELECT from_path …",
    "actions": [{ "type": "review-coupling", "description": "…" }],
    "source": "bundled"
  },
  {
    "id": "internal-flaky-tests",
    "description": null,
    "body": null,
    "sql": "SELECT path FROM files WHERE …",
    "actions": null,
    "source": "project"
  }
]
```

`description` and `body` are nullable — recipes without sibling `.md` get null. `actions` field nullability depends on grill question D.

## 6. MCP surface — auto-inherits

Already shipped in PR [#35](https://github.com/stainless-code/codemap/pull/35):

- `codemap://recipes` resource — automatically picks up project recipes since it calls `listQueryRecipeCatalog()` (which becomes the loader).
- `codemap://recipes/{id}` template — auto-resolves project recipe ids.

The agent's discovery story is unchanged; the catalog just got bigger.

## 7. Implementation deps

- No new npm dependencies. Uses `node:fs/promises` (or sync `readFileSync` for cache population) + `node:path`.
- Reuses the existing `resolveAgentsTemplateDir()` pattern for `resolveBundledRecipesDir()` (npm package layout — `templates/recipes/` next to `templates/agents/`).
- New file: `src/application/recipes-loader.ts` (loader engine — pure, transport-agnostic).
- `src/cli/query-recipes.ts` becomes a thin re-export layer that calls the loader (preserves the `getQueryRecipeSql` / `getQueryRecipeActions` / `listQueryRecipeIds` / `listQueryRecipeCatalog` / `QUERY_RECIPES` named exports for backwards-compat with the MCP server + cmd-query).

## 8. Tracer-bullet sequence

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md):

1. **Loader scaffold** — `src/application/recipes-loader.ts` with `loadAllRecipes` returning bundled-only (project loader stubbed). Tests cover empty / one-recipe / multiple-recipe loads against a fixture `templates/recipes/` directory. Commit.
2. **Migrate bundled recipes** — extract every entry in `QUERY_RECIPES` to `templates/recipes/<id>.sql`; for the ones with a meaningful one-liner already, also add `<id>.md`. `query-recipes.ts` becomes a thin shim that calls `loadAllRecipes({bundledDir, projectDir: undefined})`. Tests: every existing recipe id still resolves to the same SQL. Commit.
3. **Project-local loader** — implement `resolveProjectRecipesDir(root)` + load `.codemap/recipes/*.sql` + sibling `.md` discovery. Tests cover: no `.codemap/recipes/` (no error, no project recipes); one project recipe; project recipe shadows bundled. Commit.
4. **`--recipes-json` carries `source` + `body`** — extend the catalog output. Tests cover both source values + body presence/absence. Commit.
5. **Optional `actions` support** (depends on grill Q-D) — if YAML frontmatter wins, ship a tiny parser; if sibling `<id>.actions.json` wins, ship the lookup. Commit.
6. **Docs + agents update** — `architecture.md § Recipes wiring` paragraph, glossary entries (`recipe` definition gets the bundled-vs-project disambiguation), README CLI block (mention `.codemap/recipes/`), rule + skill across `.agents/` and `templates/agents/` (Rule 10), patch changeset. Delete this plan (Rule 2), lift canonical bits into architecture.md. Commit.

Estimated total: ~1 day across ~6 commits.

## 9. Open questions (worth a `grill-me` round before code)

### Settled

- **Q-A. Storage layout for bundled recipes?** ✅ **(i) `templates/recipes/<id>.{sql,md}` file-pair.** Uniformity with project recipes wins: one loader code path (no `if (source === "bundled")` branches), `.sql` files get SQLite syntax highlighting in every editor (today's `QUERY_RECIPES` template literals get none), single-file diffs for SQL changes, and `sqlite3 .codemap.db ".read …"` works for ad-hoc testing. Migration cost is one-time (~15 entries → ~15 `.sql` files); the shim layer in `cli/query-recipes.ts` preserves backwards-compat for `getQueryRecipeSql` / `getQueryRecipeActions` / `QUERY_RECIPES` re-exports. Rejected (ii) "code-map + sibling .md only" — smaller initial diff but two storage shapes that compound debt every time the recipe surface evolves.
- **Q-B. Loading time?** ✅ **Eager at startup.** Cost is negligible (~15-20 small file reads, sub-millisecond on warm SSD — rounding error vs node/bun startup, oxc, bun:sqlite). "Registry is always populated" eliminates per-call `if (notLoadedYet)` guards. Surfaces malformed-recipe errors at startup instead of 30-minutes-into-a-session. Rejected (ii) lazy — its win ("don't pay for what you don't use") is hypothetical for filesystem reads of static files; matters for DB connections / network calls, not 20 small files. Rejected (iii) eager-with-disk-cache — over-engineered; introduces invalidation problem for no measurable win.

### Still open

- **Q-C. Project recipes — discovery walk-up?** Today `.codemap.db` is created in the project root only. Should `.codemap/recipes/` also be project-root-only, OR walk up like `.git` does (find nearest ancestor `.codemap/recipes/` directory)? Walk-up matches monorepo intuition; root-only matches everything else codemap does today.
- **Q-D. `actions` for project-local recipes — and how specified?** Three options: (i) skip for v1 (project recipes can't have actions; bundled-only feature). (ii) YAML frontmatter on `<id>.md` (one parser dependency, e.g. `gray-matter` or hand-rolled). (iii) Sibling `<id>.actions.json` file (no parser; another file per recipe). (i) keeps v1 lean; (ii) is most ergonomic for recipe authors; (iii) is the "no new dep" middle ground.
- **Q-E. Conflict resolution loud or quiet?** When a project recipe shadows a bundled one, do we (i) silently let project win (clean), (ii) emit a one-time stderr warning ("project recipe `fan-out` shadows the bundled `fan-out`"), or (iii) require an explicit `--allow-shadow` flag? Bias toward (i) — user code wins is the convention; warnings risk noise.
- **Q-F. Validation strictness.** Reject project recipes that contain DML / DDL at load time (mirrors the `PRAGMA query_only` defence we shipped in PR #35), or let them fail at run time? Load-time rejection is more agent-friendly (fails fast on save_baseline-style misuse); run-time falls back to the engine's existing safeguard. Bias toward load-time — same lexical sanity check that's already proposed for empty-file detection.

## 10. Non-goals (v1)

- **Recipe versioning / migrations.** If a bundled recipe's SQL changes between codemap versions, project consumers using the same id silently get the new SQL on upgrade. Defer until a real consumer reports breakage.
- **Recipe parameters / templating.** No `{table}` / `{limit}` placeholder substitution — recipes are static SQL. Templating adds a parser surface and ambiguity around what's a parameter vs a SQL token. Defer until two consumers ask with the same shape.
- **Network-fetched recipes.** No `codemap recipes add github.com/foo/recipes` registry. Stay filesystem-only — security and supply-chain reasoning matches the agent-host trust boundary from the MCP plan.
- **Recipe execution control beyond `--recipe <id>`.** No `--list-recipes` shorthand (use `--recipes-json | jq`). No `codemap recipe run <id>` (use `codemap query --recipe <id>`). Single CLI surface stays.
- **`.codemap/recipes/<id>.json` (raw envelope)** — recipes are SQL-first; JSON envelope would re-invent half of `.sql` + `.md`.

## 11. References

- Roadmap entry: [`docs/roadmap.md` § Backlog](../roadmap.md#backlog).
- Existing recipe shape: [`src/cli/query-recipes.ts`](../../src/cli/query-recipes.ts) (`QUERY_RECIPES` map, `RecipeAction` interface).
- MCP resources that auto-inherit: [`docs/architecture.md` § MCP wiring](../architecture.md#cli-usage), `codemap://recipes` and `codemap://recipes/{id}`.
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
