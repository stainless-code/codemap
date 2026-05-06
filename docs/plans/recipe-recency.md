# Recipe-recency tracking — plan

> **Status:** open · plan iterating. M effort. Next in cadence per [`research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) Rationale 4 (orthogonal to (b) C.9 — recency has its own table, no `is_entry` / reachability dependency).
>
> **Motivator:** agents reading `codemap://recipes` at session start get an alphabetical list with no signal about which recipes the project actually uses. A 90-day-windowed `last_run_at` + `run_count` per recipe lets agent hosts sort by recency / frequency, surfacing live recipes ahead of historic ones. Local-only (no upload primitive) — resists the future telemetry-creep PR by construction.
>
> **Tier:** M effort. New table, reconciler at the existing tool-handler seam, ~one column-set extension to `--recipes-json`. No new transport, no new engine, no schema-breaking change.

---

## Pre-locked decisions

These are committed to v1 (lifted directly from the [roadmap.md § Backlog](../roadmap.md#backlog) entry — the roadmap itself is the locking surface). Questions opened against them must justify against the linked floors / moats.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Source                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| L.1 | **New `recipe_recency` table** keyed by `recipe_id`, three-column minimal shape (`recipe_id TEXT PK`, `last_run_at INTEGER`, `run_count INTEGER`), `STRICT, WITHOUT ROWID`, partial index on `last_run_at` for prune scans. See [Q1 Resolution](#q1-resolution).                                                                                                                                                                                                                                                                                    | Roadmap entry + Q1 grilling                                                       |
| L.2 | **Two write sites, one shared helper.** MCP+HTTP both flow through `handleQueryRecipe` in `application/tool-handlers.ts`; CLI `query --recipe` dispatches separately through `runQueryCmd` in `cli/cmd-query.ts` (calls `getQueryRecipeSql` + `printQueryResult` directly, NOT through tool-handlers). Both call a shared `recordRecipeRun({db, recipeId})` helper from `application/recipe-recency.ts` after the recipe execution succeeds. Mirrors the `boundary_rules` reconciler shape — one helper, called from the appropriate orchestrators. | Verified via `codemap query` against `calls` + `imports` tables — see Q2 grilling |
| L.3 | **Rolling 90-day retention** — rows whose `last_run_at` falls outside the window get pruned. Trigger (eager / lazy / scheduled) resolved by Q3.                                                                                                                                                                                                                                                                                                                                                                                                     | Roadmap entry                                                                     |
| L.4 | **Opt-out via `.codemap/config.ts` `recipe_recency: false`** (default ON). Schema addition to `codemapUserConfigSchema` (Zod).                                                                                                                                                                                                                                                                                                                                                                                                                      | Roadmap entry — explicit "opt-out" wording                                        |
| L.5 | **Surfaces in `--recipes-json`** (CLI flag) and the matching `codemap://recipes` resource. Per-entry shape resolved by Q5.                                                                                                                                                                                                                                                                                                                                                                                                                          | Roadmap entry                                                                     |
| L.6 | **Local-only — no upload primitive ever ships.** No telemetry endpoint, no `--report-recency` flag, no opt-in SaaS. The `recipe_recency` table stays inside `<state-dir>/index.db`. The Floor exists to resist accumulation pressure.                                                                                                                                                                                                                                                                                                               | [Floor "No telemetry upload"](../roadmap.md#floors-v1-product-shape)              |
| L.7 | **Moat-A clean.** Recency is metadata about run frequency, not a verdict; recipes still ARE the SQL. No new verdict-shaped CLI verb; consumers compose `--recipes-json` + `jq` for "rank by recency" queries.                                                                                                                                                                                                                                                                                                                                       | [Moat A](../roadmap.md#moats-load-bearing)                                        |
| L.8 | **Failure-mode isolation.** A recency-write failure (DB locked, disk full, schema drift) NEVER blocks the actual recipe execution. The reconciler runs after the recipe result is computed; errors are swallowed with a stderr warning (`[recency] write failed: <reason>`).                                                                                                                                                                                                                                                                        | Same shape as `boundary_rules` reconciler — never-blocking                        |

---

## Open decisions (iterate as the plan converges)

Each gets a "Resolution" subsection below as it crystallises (mirrors the `c9-plugin-layer.md` / `github-marketplace-action.md` / `lsp-diagnostic-push.md` pattern).

- **Q1 — Exact schema shape.** Column types and table options:

  ```sql
  CREATE TABLE recipe_recency (
    recipe_id    TEXT PRIMARY KEY,        -- matches QUERY_RECIPES key + project-recipe id
    last_run_at  INTEGER NOT NULL,        -- epoch ms, mirrors `meta.indexed_at`
    run_count    INTEGER NOT NULL DEFAULT 1
  ) STRICT, WITHOUT ROWID;
  ```

  Variants to weigh: do we want a `first_run_at` column for "how long has this recipe been in rotation"? Source breakdown (`source TEXT` discriminator: `cli` / `mcp` / `http`)? `errored_run_count` for failed runs (Q9)? Default bias is the minimal three-column shape above; richer shapes earn their place when a real consumer asks.

  ### Q1 Resolution

  **Locked: minimal three-column shape, no extras for v1.**

  ```sql
  CREATE TABLE recipe_recency (
    recipe_id    TEXT PRIMARY KEY,
    last_run_at  INTEGER NOT NULL,
    run_count    INTEGER NOT NULL DEFAULT 1
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX idx_recipe_recency_last_run ON recipe_recency(last_run_at);
  ```

  Reasoning:
  - `STRICT, WITHOUT ROWID` matches the `dependencies` / `meta` precedent (TEXT PK → data lives in PK B-tree; one indirection less, lower storage footprint).
  - `idx_recipe_recency_last_run` keeps the prune `DELETE WHERE last_run_at < <cutoff>` an indexed scan as project-recipe counts grow.
  - **Rejected for v1, additively promotable later (Moat-A discipline + roadmap two-consumer-trigger precedent):**
    - `first_run_at` — speculative; no recipe today asks "how long has this been in rotation."
    - `source TEXT` discriminator — covered by Q4 (project-recipe shadowing) at a different angle; revisit if a consumer wants per-transport breakdown.
    - `errored_run_count` — collapses into Q9 (what counts as a run); if Q9 lands on "successful runs only" this column is dead weight.

- **Q2 — Which entry points write to recency?** Two candidates after the architectural fact-check (CLI does NOT go through `tool-handlers.ts` — `cmd-query.ts` calls `getQueryRecipeSql` + `printQueryResult` directly; verified via `calls` + `imports` queries against the live index):
  - **(b) MCP/HTTP only** — instrument `handleQueryRecipe` in `application/tool-handlers.ts` only. Strict reading of the roadmap wording ("MCP/HTTP request boundary"). One write site. Trade-off: misses every bash agent shelling out `codemap query --recipe X` — the documented invocation pattern in both `templates/agents/` and `.agents/rules/codemap.md`.
  - **(c) MCP/HTTP + CLI** — instrument `handleQueryRecipe` (covers MCP + HTTP — both flow through it) AND `runQueryCmd`'s `--recipe` branch in `cli/cmd-query.ts` (covers CLI). Both call a shared `recordRecipeRun({db, recipeId})` helper from `application/recipe-recency.ts`. Two write sites, one helper.

  ### Q2 Resolution

  **Locked: (c) MCP/HTTP + CLI.**

  Reasoning:
  - The bundled agent skill + `.agents/rules/codemap.md` lead with `codemap query --json --recipe <id>` (the CLI form) as the documented agent invocation. Excluding CLI guts the signal for the recommended path.
  - Roadmap's "MCP/HTTP request boundary" wording is loose; the principle is "instrument the request-boundary equivalent on every transport agents use" — all three transports qualify.
  - Cost is ~5 lines in `handleQueryRecipe` after `executeQuery` returns + ~5 lines in `runQueryCmd` after the `--recipe` branch resolves successfully — both calling the same helper.
  - Failure-mode isolation (L.8) protects both sites uniformly via the shared helper's internal `try/catch`.

  Locked into L.2 (above).

- **Q3 — Pruning trigger.** When does the 90-day cutoff actually run?
  - **(a) Eager** — every write does `DELETE FROM recipe_recency WHERE last_run_at < <cutoff>` before the upsert. Cheap (single indexed scan; rows count ≈ recipe count, ~30 rows today). Always-fresh, no surprise drift.
  - **(b) Lazy** — only on `--recipes-json` reads. Writes never prune. Simpler write path; reads see "fresh after first read" semantics.
  - **(c) Scheduled** — separate prune step (e.g. on `bun src/index.ts --full` or boot). Adds a wiring point.

  ### Q3 Resolution

  **Locked: (b) Lazy.** Switched from the draft default (a) after sharper analysis.

  Reasoning:
  - **Freshness is a read-time concern, not write-time.** Agents consume recency via `--recipes-json` reads; the table's between-reads state has no consumer. Pruning at write does more work than necessary.
  - **Hot path stays cheap.** Recipe execution is the hot path; write-site cost matters more than read-site cost (reads are infrequent — session-start). Lazy keeps writes pure upserts; eager adds an indexed DELETE scan per call.
  - **Failure isolation symmetry.** Under L.8 write failures get swallowed silently. With (a), a consistently-failing prune lets the table grow unbounded silently. With (b), prune failures only affect a single `--recipes-json` read — the next read retries. Read-side failures are louder by nature.
  - **Bot-driven session resilience.** A bot calling 1M recipes burns 1M indexed-DELETE scans under (a); under (b) it burns 1M pure upserts and prunes once on next `--recipes-json` read.
  - **Reject (c) scheduled** — long-running `mcp` / `serve` sessions never invoke `--full` / boot; the table grows for the whole session. Strictly worse than (b).

  Implementation: `loadRecipeRecency({db, recipeIds?})` invokes `pruneRecipeRecency({db, cutoffMs: now - 90*86400_000})` before its SELECT. Pure functions in `application/recipe-recency.ts`; the prune is part of the load contract, not a separate verb consumers wire.

- **Q4 — Project-local recipes (shadows).** A project recipe with the same id as a bundled recipe (`shadows: true` per [`recipes-loader.ts`](../architecture.md#cli-usage)) — does it share a `recipe_recency.recipe_id` row with the bundled one, or get its own?
  - **(a) Shared row** — `recipe_id` is the only key. Trade-off: when a project shadows `untested-and-dead`, you can't tell from recency whether the bundled or the project version was hit.
  - **(b) Separate rows** with a `source: "bundled" | "project"` discriminator. Composite PK `(recipe_id, source)`. Mirrors the `--recipes-json` discriminator already in place.

  ### Q4 Resolution

  **Locked: (a) Shared row.**

  Reasoning:
  - **Only one version is ever reachable per id.** Project wins on collision per `recipes-loader.ts`; bundled is unreachable while shadowed. The bundled row would never get written; (b) solves a non-problem.
  - **Continuity across shadow add/remove.** Only realistic transition is shadow added or removed. Under (a), `last_run_at` carries through both — agent sees consistent "this id has been used recently." Under (b), removing a shadow creates a discontinuity (project stale, bundled fresh-zero).
  - **Q1's locked PK stays clean.** (b) would require re-opening Q1 to change PK from `TEXT PRIMARY KEY` to `(recipe_id, source) PRIMARY KEY` — schema redesign for zero current consumer demand.
  - **Promotion path additive.** If a future consumer asks for bundled-vs-project breakdown: add non-PK `source TEXT` column, default `'bundled'`. No PK migration. No data loss.

- **Q5 — `--recipes-json` shape.** Per-entry inline fields or a separate top-level block?
  - **(a) Inline** — every recipe entry gets `last_run_at: <ms> | null` and `run_count: <n>`. Agents reading the catalog see recency on the same object they sort by `id`.
  - **(b) Separate `recency:` map** — `{recipes: [...], recency: {<id>: {last_run_at, run_count}}}`. Keeps the recipe shape stable for consumers that don't want recency.

  ### Q5 Resolution

  **Locked: (a) Inline.**

  Verified empirically: current `--recipes-json` is a **bare JSON array** of entry objects (each with `id`, `description`, `sql`, `source`, `body`, `actions`, etc.). (b) would wrap in `{recipes, recency}` — a breaking change for every `jq '.[] | …'` consumer.

  Reasoning:
  - **(b) breaks bare-array consumers.** Not worth re-opening backwards-compat for a packaging preference.
  - **Existing precedents are inline.** `actions`, `params`, `body`, `source`, `shadows` all landed as inline fields per the verified shape. Recency matches the additive-evolution pattern.
  - **Agent-friendly co-location.** `jq 'sort_by(.last_run_at // 0) | reverse'` is a single field on the entry agents already iterate; (b) forces a top-level join.
  - **Null semantics for never-run.** `last_run_at: null`, `run_count: 0` for recipes never executed; consumers filter with `select(.last_run_at != null)` or treat null as "fresh."
  - **MCP resource symmetry.** `codemap://recipes` and `codemap://recipes/{id}` mirror the inline shape via `application/resource-handlers.ts` — Slice 3 ships identical shape on all surfaces with no parallel map-merge step.

- **Q6 — Does codemap re-rank, or just expose data?** Two flips:
  - **(a) Expose-only** — `--recipes-json` keeps alphabetical / source order; consumers re-rank with `jq sort_by(.last_run_at)`. Moat-A clean (no opinion baked in).
  - **(b) Re-rank by default** — `--recipes-json` returns recency-sorted; alphabetical is `--recipes-json --sort=id`. Friendlier for agents that don't post-process.

  ### Q6 Resolution

  **Locked: (a) Expose-only.**

  Reasoning:
  - **Moat-A discipline.** Codemap exposes substrate; consumers decide relevance. Re-ranking IS an opinion (recency vs frequency vs `recency × frequency`?). Baking one in violates the "predicate-as-API + pure structural" framing.
  - **Multiple valid orderings, none dominates.** Alphabetical (human scan), by source ("what this project added"), by recency (active recipes), by frequency (popular), by `actions[].type` (action-driven). Picking one in default output disenfranchises every other use case.
  - **Stable order = stable diffs.** Alphabetical (current) is deterministic — golden-query snapshots and PR diffs stay clean. (b) makes every `--recipes-json` snapshot order-churn on every recipe execution.
  - **One-liner composition costs nothing.** `codemap query --recipes-json | jq 'sort_by(-.last_run_at // 0)'` matches the established `audit | jq` CI idiom from `roadmap.md § Backlog`. Agents that want recency-ranking get it free; agents that want alphabetical keep it.
  - **Promotion path additive.** If two consumers ship `jq sort_by(.last_run_at)` workflows with similar shapes (the documented two-consumer-trigger gate), promote `--sort=last-run` as additive sugar. Default flip stays gated.

- **Q7 — Schema lifecycle.** Does `recipe_recency` survive `--full` and `SCHEMA_VERSION` rebuilds, or get dropped each time?
  - **(a) Survives** — joins the `query_baselines` / `coverage` precedent: intentionally absent from `dropAll()`. Recency is user-activity data, not derived index content.
  - **(b) Drops** — joins `boundary_rules` / `dependencies` / `symbols`: rebuilt deterministically on every full reindex. Simpler — no special-case handling.

  ### Q7 Resolution

  **Locked: (a) Survives.**

  Reasoning:
  - **Recipe recency is user-activity data, not derived index content.** Tracks "which recipes the agent / user ran"; no source-of-truth to rederive from. Wiping on full reindex zeros the signal for no recoverable reason.
  - **Branch switch + `SCHEMA_VERSION` bump are the dominant `--full` triggers.** Both are common; both leave `query_baselines` and `coverage` intact. Recipe recency joins the same posture.
  - **Direct precedent.** Per [`architecture.md` § `coverage`](../architecture.md#coverage--statement-coverage-user-data-strict-without-rowid): _"Same lifecycle posture as `query_baselines`: intentionally absent from `dropAll()` so `--full` and `SCHEMA_VERSION` rebuilds preserve user ingest."_ Three precedents makes "user-data tables survive `dropAll()`" a documentable pattern worth lifting into `architecture.md` § Schema in Slice 5.
  - **No CASCADE hazard.** `recipe_recency` doesn't FK to any table; `recipe_id` is loose (matches bundled or project ids — no `recipes` SQLite table to FK against). Simply omit from `dropAll()`.
  - **The 90-day prune (Q3) handles staleness;** keeping data has no downside.

- **Q8 — Schema migration.** Does adding `recipe_recency` bump `SCHEMA_VERSION`?
  - Per [`.agents/lessons.md`](../../.agents/lessons.md) "changesets bump policy (pre-v1)": adding a new table that doesn't break existing readers is a **patch**, not a minor — `SCHEMA_VERSION` only bumps when DDL changes break old `.codemap/index.db` files. New table additive → no `SCHEMA_VERSION` bump needed; `createSchema()` creates it on next boot. Confirm by walking the create-or-migrate path in `db.ts`.

  ### Q8 Resolution

  **Locked: NO `SCHEMA_VERSION` bump. Patch changeset.**

  Verified mechanism in `db.ts`:
  - `createTables()` uses `CREATE TABLE IF NOT EXISTS` for every table; called via `createSchema()` on every boot.
  - `SCHEMA_VERSION` mismatch triggers `dropAll()`; current value is `10`.
  - For an existing DB at version 10 + new code shipping `recipe_recency`: table appears via `IF NOT EXISTS` on first boot. No rebuild. No data loss.

  Reasoning:
  - **Lessons file is explicit:** _"Don't propose `minor` just because new CLI commands or public types were added."_ Additive tables are patch.
  - **Bumping is strictly worse.** `dropAll()` would force a ~85ms full rebuild (per benchmark.md) for zero migration benefit — `recipe_recency` doesn't need pre-population.
  - **DDL placement.** Add `CREATE TABLE IF NOT EXISTS recipe_recency (…)` + `idx_recipe_recency_last_run` inside `createTables()`, sibling to `query_baselines` + `coverage` (the user-data substrate). Skip `dropAll()` per Q7. No `meta` key needed.
  - **Future column additions** would need `ALTER TABLE` + version-bump strategy. Out of scope for v1.

- **Q9 — What counts as a "run"?** Three candidates:
  - **(a) Successful executions only** — recency reflects "this recipe produced rows the agent used."
  - **(b) Any execution** — including SQL errors, param-validation rejections, FTS5-disabled errors. Recency reflects intent.
  - **(c) Success + param-validation success** — exclude infrastructure errors (DB locked, schema drift) but count "recipe actually ran end-to-end."

  ### Q9 Resolution

  **Locked: (a) Successful executions only.**

  Reasoning:
  - **(c) collapses into (a).** Q10's locked failure-isolation pattern places `recordRecipeRun` AFTER successful execution. Any throw exits before the call site; (a) and (c) reach the same code by construction.
  - **(b) inflates under adversarial / typo conditions.** Bot retrying 100× with a bad param → `run_count = 100` for a recipe that never produced useful output. Misleading signal.
  - **0-row results are legitimate runs.** A clean `[]` return means "no rows match" — deliberate, useful information. Counting preserves the signal.
  - **Q1's locked schema agrees.** No `errored_run_count` column reserved; (b) would re-open Q1.
  - **Promotion path additive.** If a future consumer wants intent-including-failures, add `errored_run_count INTEGER DEFAULT 0` non-PK. No PK migration; existing rows get 0.
  - **Code-site simplicity.**

    ```typescript
    const result = executeRecipe(...);  // throws on any failure
    try { recordRecipeRun(db, recipeId); } catch { /* L.8 swallow */ }
    return result;
    ```

    Unconditional after the throw point; no error-path branching.

- **Q10 — Failure-mode isolation + sampling.** L.8 commits to "never block." Concrete guard:

  ```typescript
  // After the recipe result is computed, before returning to the caller:
  try {
    recordRecipeRun(db, recipeId);
  } catch (err) {
    if (!quiet)
      console.warn(`[recency] write failed: ${(err as Error).message}`);
  }
  return result;
  ```

  Question: also sample writes (every Nth call) to mitigate hot-path overhead?

  ### Q10 Resolution

  **Locked: try/catch isolation; NO sampling.**

  Reasoning:
  - **Cost is negligible.** Pure upsert into a tiny indexed table is ~1µs; recipe execution itself is ms+. Recency write is <0.1% of execution time after Q3's locked Lazy prune (no DELETE on the write path).
  - **Sampling solves no real problem and adds complexity.** In-memory per-process counters undercount under multi-process workloads (concurrent CLI + `mcp` + `serve`); DB-backed counters replace one upsert with one read+update (same cost); random sampling discards signal that's the whole point of the table.
  - **`--performance` is the escape hatch.** If a future report shows recency writes in the top phase contributors, revisit. Until then, no premature optimization.

- **Q11 — Test approach.**

  ### Q11 Resolution

  **Locked: per-slice tests as described below.**
  - **Unit (Slice 1):** `recordRecipeRun` + `pruneRecipeRecency` + `loadRecipeRecency` — pure functions over `(db, …)`. `src/application/recipe-recency.test.ts` covers happy path + 90-day cutoff boundary + opt-out short-circuit + null-row-on-never-run shape. Bun test runner; in-memory `:memory:` SQLite per test for isolation.
  - **Integration / write-site (Slice 2):**
    - **MCP/HTTP path** — extend `src/application/tool-handlers.test.ts` (or sibling) with a recipe-call assertion: invoke `handleQueryRecipe`, then `loadRecipeRecency` returns one row with the expected `recipe_id` + `run_count >= 1`.
    - **CLI path** — extend `src/cli/cmd-query.test.ts` with the same assertion via `runQueryCmd({recipe: 'fan-out', …})`.
    - Both paths share the same shared-helper write-site per Q2.
  - **`--recipes-json` shape (Slice 3):** golden-query snapshot at `fixtures/golden/scenarios.json` runs three recipes against `fixtures/minimal/`, then `query --recipes-json`, asserts the inline `last_run_at` / `run_count` fields appear with stable placeholders (`last_run_at: <number>` matcher) so the snapshot stays diff-stable.
  - **Opt-out (Slice 4):** dedicated test sets `recipe_recency: false` in user config, runs a recipe, asserts `recipe_recency` table stays empty.
  - **Failure mode (Slice 2):** test against a read-only DB asserts the recipe still returns rows AND a stderr warning lands matching `/\[recency\] write failed/`.
  - **Lazy prune (Slice 1):** test inserts a row with `last_run_at = now - 91d`, calls `loadRecipeRecency`, asserts the row was pruned and load returns empty.

- **Q12 — Boundary-check codification.** Ship a forbidden-edge query in Slice 2's verification recipe so future PRs introducing a third write site get caught.

  ### Q12 Resolution

  **Locked: yes, codify in Slice 2's verification recipe.**

  Per Q2, the only legitimate write callers of `recordRecipeRun` are:
  - `src/application/tool-handlers.ts` (covers MCP + HTTP)
  - `src/cli/cmd-query.ts` (covers CLI)
  - `src/application/recipe-recency.test.ts` (test harness)

  Boundary check (re-runnable as part of Slice 2's verification recipe):

  ```bash
  bun src/index.ts query --json "
    SELECT DISTINCT file_path
    FROM imports
    WHERE source LIKE '%application/recipe-recency%'
      AND specifiers LIKE '%recordRecipeRun%'
      AND file_path NOT IN (
        'src/application/tool-handlers.ts',
        'src/cli/cmd-query.ts',
        'src/application/recipe-recency.test.ts'
      )
  "
  ```

  Expected output: `[]`. Non-empty = a new write site appeared without a docs / boundary-check update; reviewer escalates per [`audit-pr-architecture` § 2](../../.agents/skills/audit-pr-architecture/SKILL.md#2-derive-the-boundary-leak-sql-kit-from-the-repos-own-architecture).

  `loadRecipeRecency` (read path) is a normal export — any consumer can import it (Slice 3 wires `--recipes-json` reads). The boundary check discriminates by `specifiers LIKE '%recordRecipeRun%'`, not by source path alone.

---

## High-level architecture

Three pieces; all small, no new engines.

1. **Schema** (`src/db.ts`) — `createTables()` adds `recipe_recency` per Q1 Resolution; `dropAll()` does NOT include it per Q7 Resolution; `idx_recipe_recency_last_run` partial index for the lazy prune `DELETE` (Q3 Resolution).
2. **Engine** (`src/application/recipe-recency.ts`, new) — pure functions: `recordRecipeRun({db, recipeId, now?})` (write — used by Slice 2), `pruneRecipeRecency({db, cutoffMs})` (private; called by `loadRecipeRecency` per Q3), `loadRecipeRecency({db})` returning `Map<recipe_id, {last_run_at, run_count}>` (read — used by Slice 3). Mirrors the `application/coverage-engine.ts` shape (pure transport-agnostic).
3. **Wiring (two write sites, one helper)** per Q2 / L.2:
   - **MCP + HTTP** — `handleQueryRecipe` in `application/tool-handlers.ts`: after `executeQuery` resolves successfully, call `recordRecipeRun` (Q10-isolated try/catch).
   - **CLI** — `runQueryCmd` in `cli/cmd-query.ts`: same shape, after the `--recipe` branch's SQL completes successfully.
   - Read site: `--recipes-json` (CLI + `codemap://recipes` resource via `application/resource-handlers.ts`) calls `loadRecipeRecency` and joins inline per Q5.

No CLI flag. No new transport. No engine duplication.

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

1. **Slice 1: schema + engine.** Add the table to `db.ts` (`createTables()` only — `dropAll()` skip is intentional per Q7 Resolution; no `SCHEMA_VERSION` bump per Q8 Resolution). Implement `recordRecipeRun` + `pruneRecipeRecency` + `loadRecipeRecency` with unit tests in `src/application/recipe-recency.test.ts` (per Q11 Resolution). Verify via raw SQL: `bun src/index.ts query "SELECT * FROM recipe_recency"` returns `[]` on a fresh DB.
2. **Slice 2: write sites — both transports** (per Q2 Resolution).
   - **MCP/HTTP path:** hook `recordRecipeRun` in `handleQueryRecipe` (`application/tool-handlers.ts`) after `executeQuery` resolves successfully. Q10-isolated `try/catch`.
   - **CLI path:** hook `recordRecipeRun` in `runQueryCmd` (`cli/cmd-query.ts`) after the `--recipe` branch's SQL completes successfully. Same isolation.
   - Smoke: `bun src/index.ts query --recipe fan-out --json` then `bun src/index.ts query "SELECT * FROM recipe_recency"` shows one row.
   - Failure-mode test against a read-only DB (per Q11 Resolution).
   - Boundary check codified per Q12 Resolution: forbidden-edge query asserting only `tool-handlers.ts` + `cmd-query.ts` + the test file import `recordRecipeRun`.
3. **Slice 3: `--recipes-json` inline read** (per Q5 Resolution). Every entry gains `last_run_at: <ms> | null` and `run_count: <n>`. `loadRecipeRecency` runs the lazy prune (per Q3 Resolution) before the SELECT. Update CLI render in `cmd-query.ts`, MCP `codemap://recipes` + `codemap://recipes/{id}` resources via `resource-handlers.ts`, HTTP `GET /resources/codemap%3A%2F%2Frecipes`. Add a golden-query snapshot at `fixtures/golden/scenarios.json` with `last_run_at: <number>` matcher for stable diffs.
4. **Slice 4: opt-out config.** Add `recipe_recency: z.boolean().default(true)` to `codemapUserConfigSchema` (per L.4). When `false`, `recordRecipeRun` short-circuits before any DB write (the cleanest opt-out — no rows ever land; load returns empty by construction). Verify both modes via dedicated tests.
5. **Slice 5: docs + agent rule lockstep.** Per [`docs/README.md` Rule 10](../README.md):
   - `docs/architecture.md` § Schema → new `recipe_recency` table row (matching the existing `coverage` / `query_baselines` shape).
   - `docs/glossary.md` → `recipe_recency` entry.
   - **Both** `templates/agents/rules/codemap.md` + `templates/agents/skills/codemap/SKILL.md` AND `.agents/rules/codemap.md` + `.agents/skills/codemap/SKILL.md` updated in lockstep — agents need to know `--recipes-json` carries the new fields.
   - Per [`docs/README.md` Rule 2](../README.md): remove the recipe-recency entry from `roadmap.md § Backlog` and **delete this plan file** (per Rule 3 — plans die when work ships; durable design lives in `architecture.md` / `glossary.md` / agent surface).

### Slice 5 cleanup runbook (post-merge)

Mirrors the precedent set by `github-marketplace-action.md § Slice 5 runbook`:

1. Confirm Slices 1-4 shipped on `main` (CI green; recipe-recency populates on a fresh `bun src/index.ts query --recipes-json`).
2. Update durable homes in one PR:
   - `docs/architecture.md` § Schema — add `recipe_recency` table description.
   - `docs/glossary.md` — add `recipe_recency` / "recipe recency" entry.
   - `templates/agents/rules/codemap.md` + `templates/agents/skills/codemap/SKILL.md` — note the `--recipes-json` field additions.
   - `.agents/rules/codemap.md` + `.agents/skills/codemap/SKILL.md` — same additions, CLI-prefix-only delta vs templates.
3. Remove the recipe-recency entry from `roadmap.md § Backlog`.
4. **Delete `docs/plans/recipe-recency.md`** per [`docs/README.md` Rule 3](../README.md). No tombstone (per [`docs-governance` § Closing a plan](../../.agents/skills/docs-governance/SKILL.md#closing-a-plan)).
5. Re-grep for orphaned references: `rg "recipe-recency.md"` should return zero hits outside the deletion commit.

---

## Test approach

Covered inline at Q11. Each slice ships its own tests; Slice 3 adds the golden-query snapshot.

---

## Risks / non-goals

| Item                                                                           | Mitigation                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-goal:** telemetry / SaaS aggregation of recency.                         | Per L.6; data stays in `<state-dir>/index.db`. The Floor exists to resist accumulation pressure. PR reviewers reject any "phone home" addition.                                                                                                                                 |
| **Non-goal:** recency-driven re-ranking baked into `--recipes-json`.           | Per Q6 Resolution. Consumers compose; codemap exposes columns. Promotion gated on two-consumer trigger.                                                                                                                                                                         |
| **Non-goal:** verdict-shaped CLI verb (`codemap recipes-by-recency`).          | Per L.7 (Moat A). Recipes are SQL; recency is metadata. `query --recipes-json \| jq` is the idiom.                                                                                                                                                                              |
| **Risk:** recency-write failures block recipe execution.                       | Per L.8 + Q10 Resolution; `try/catch` swallow with stderr warning. Failure-mode test in Slice 2 locks the contract.                                                                                                                                                             |
| **Risk:** schema drift between bundled and project recipes inflates the table. | Per Q4 Resolution — shared `recipe_id` row. Worst case: one row per known id (~30 bundled + project recipes). The 90-day prune (Q3 Resolution) keeps it bounded regardless.                                                                                                     |
| **Risk:** the table grows unboundedly on bot-driven sessions.                  | Pruning is lazy on `--recipes-json` reads (Q3 Resolution). Even an adversarial bot calling 1M recipes only ever populates one row per distinct id; the table is bounded by recipe-id cardinality. `run_count` is `INTEGER` — overflow is theoretically possible but irrelevant. |
| **Risk:** plan abandoned mid-iteration.                                        | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. The schema delta is small enough that partial impl can be reverted cleanly.                                                                                                   |

---

## Cross-references

- [`docs/roadmap.md § Backlog`](../roadmap.md#backlog) — recipe-recency entry (deleted by Slice 5 cleanup runbook above).
- [`docs/architecture.md § Schema`](../architecture.md#schema) — destination for the durable schema description (Slice 5).
- [`docs/glossary.md`](../glossary.md) — destination for the durable term entry (Slice 5).
- [`docs/research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) — cadence rationale (orthogonal to (b) C.9).
- [`docs/architecture.md § Tool / resource handlers`](../architecture.md#cli-usage) — the seam being instrumented (L.2).
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location + deletion-on-ship).
- [`docs/README.md` Rule 10](../README.md) — agent rule + skill lockstep update (Slice 5).
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence.
- [`.agents/skills/docs-governance/SKILL.md § Closing a plan`](../../.agents/skills/docs-governance/SKILL.md#closing-a-plan) — delete-on-ship discipline.
