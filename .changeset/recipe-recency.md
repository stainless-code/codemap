---
"@stainless-code/codemap": patch
---

**Recipe-recency tracking** — every successful `--recipe` call now writes to a new `recipe_recency(recipe_id PK, last_run_at, run_count)` table. `--recipes-json` and the matching `codemap://recipes` / `codemap://recipes/{id}` MCP resources gain inline `last_run_at: number | null` + `run_count: number` fields per entry, so agent hosts can rank live recipes ahead of historic ones via `jq 'sort_by(.last_run_at // 0) | reverse'`. Default ON; opt-out via `.codemap/config` `recipe_recency: false` (short-circuits before any DB write — no rows ever land).

Two write sites both call a shared `recordRecipeRun` helper from `application/recipe-recency.ts`: `handleQueryRecipe` in `application/tool-handlers.ts` (covers MCP + HTTP — both flow through it) and `runQueryCmd` in `cli/cmd-query.ts` (CLI — finally-block observes `process.exitCode` as the unified success signal). Counts only successful runs; recency-write failures are swallowed with a stderr `[recency] write failed: <reason>` warning so they NEVER block the recipe response. The 90-day rolling window is enforced lazily on `--recipes-json` reads (no DELETE on the write path).

The MCP/HTTP catalog cache was dropped — caching the JSON.stringify result alongside recency would freeze `last_run_at` at first-read forever per long-running `codemap mcp` / `codemap serve` lifetime. The underlying `listQueryRecipeCatalog()` is itself module-cached upstream, so the extra cost is one DB-read + one JSON.stringify per call. Schema / skill resources stay cached.

**Local-only — no upload primitive ever ships.** The Floor exists to resist accumulation pressure. Sibling to `query_baselines` / `coverage`: intentionally absent from `dropAll()` so `--full` and `SCHEMA_VERSION` rebuilds preserve user-activity history. **No `SCHEMA_VERSION` bump** — the new table is purely additive and lands on existing DBs via `CREATE TABLE IF NOT EXISTS` on next boot.

Schema docs: `architecture.md` § `recipe_recency`. Term entry: `glossary.md`. Bundled agent rule + skill (`templates/agents/`) + dev-side mirror (`.agents/`) updated in lockstep per Rule 10.
