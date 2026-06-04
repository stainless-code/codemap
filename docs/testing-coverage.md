# Testing coverage map

**Purpose:** Maintainer reference for how Codemap capabilities are regression-tested. Consumers do not need this file.

**Operational entry points:** [CONTRIBUTING § Golden queries](../.github/CONTRIBUTING.md) · [golden-queries.md](./golden-queries.md) · [benchmark.md § Fixtures](./benchmark.md#fixtures)

---

## Harness layers

| Layer                  | Command                                                                    | What it proves                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Unit**               | `bun test ./src`                                                           | Parsers, DB DDL, engines, CLI/MCP handlers in isolation (`:memory:` or mocks).                                          |
| **In-repo test bench** | `bun run test:golden`                                                      | Index `fixtures/minimal/` (bench corpus) → compare `fixtures/golden/minimal/*.json`. Map: `fixtures/CAPABILITIES.json`. |
| **Golden guard**       | `bun run test:scripts`                                                     | `scripts/query-golden-coverage-matrix.test.mjs` — every bundled recipe + substrate table has a scenario.                |
| **Agent eval**         | `bun run test:agent-eval`                                                  | Probe arms vs golden ids (MCP-on vs glob/read).                                                                         |
| **Integration (git)**  | `src/application/run-index.test.ts`                                        | `runCodemapIndex` incremental paths: heritage + calls re-resolution, delete/reindex.                                    |
| **CLI e2e**            | `src/cli/cmd-test-bench-e2e.test.ts`, `src/cli/cmd-cli-parity-e2e.test.ts` | Spawned CLI on `fixtures/minimal` (bench smoke + resource parity).                                                      |
| **Apply CLI e2e**      | `src/cli/cmd-apply.test.ts`                                                | Temp project + full index: recipe dry-run/apply, `--rows`, second recipe disk apply.                                    |
| **Check**              | `bun run check`                                                            | build + lint + unit + scripts + golden + agent-eval.                                                                    |

Refresh Tier A goldens after intentional fixture or schema changes:

```bash
bun scripts/query-golden.ts --update
```

---

## Bundled recipes

Every `templates/recipes/<id>.sql` has **≥1** scenario in `fixtures/golden/scenarios.json` with `"recipe": "<id>"`. Enforced by `query-golden-coverage-matrix.test.mjs`. List ids: `codemap query --recipes-json` or `ls templates/recipes/*.sql`.

### Apply-shaped recipes (diff row contract)

| Recipe id               | Golden scenario(s)                                                               | CLI e2e (`cmd-apply.test.ts`)                |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| `rename-preview`        | `rename-preview`, `rename-preview-product-card` (barrel + re-export + reference) | dry-run, `--yes` disk apply, Q6/Q7           |
| `migrate-import-source` | `migrate-import-source`                                                          | dry-run                                      |
| `replace-marker-kind`   | `replace-marker-kind`                                                            | `--yes` disk apply (temp project)            |
| `add-jsdoc-deprecated`  | `add-jsdoc-deprecated`                                                           | — (query golden only; writes need `--force`) |

**Input modes:** recipe id (above); `--rows` JSON file (e2e); `--diff-input` (`apply-diff-input.test.ts` unit). MCP `apply_rows` shares the rows path — no separate e2e yet.

---

## Substrate tables — SQL pin-down scenarios

Recipe goldens prove query _behavior_; these scenarios pin **persisted rows** on the minimal corpus. Pin-down ids enforced in CI: `SUBSTRATE_SCENARIO_BY_TABLE` in `scripts/query-golden-coverage-matrix.test.mjs` (plus every bundled recipe id). `index-table-stats` and `call-resolution-stats` are additional aggregate/residual scenarios on the same corpus.

| Table                                 | Scenario id                                             |
| ------------------------------------- | ------------------------------------------------------- |
| Aggregate counts (all indexed tables) | `index-table-stats`                                     |
| `meta`                                | `meta-fts5-enabled`, `call-resolution-stats` (residual) |
| `source_fts`                          | `source-fts-row-count`                                  |
| `file_metrics`                        | `file-metrics-complexity-fixture`                       |
| `scopes`                              | `scopes-product-card`                                   |
| `references`                          | `references-product-card-perms`                         |
| `bindings`                            | `bindings-createClient`                                 |
| `import_specifiers`                   | `import-specifiers-consumer`                            |
| `async_calls`                         | `async-calls-prefetch`                                  |
| `decorators`                          | `decorators-sealed`                                     |
| `dynamic_imports`                     | `dynamic-imports-prefetch`                              |
| `module_cycles`                       | `module-cycles-cache-store`                             |
| `re_export_chains`                    | `re-export-chains-product-card`                         |
| `runtime_markers`                     | `runtime-markers-env`                                   |
| `function_params`                     | `function-params-createClient`                          |
| `boundary_rules`                      | `boundary-rules-ui-no-api`                              |
| `unresolved_calls`                    | `unresolved-call-sites`                                 |
| `calls` (resolution)                  | `calls-createClient-resolved`                           |
| `try_catch`                           | `try-catch-rethrow-heuristics`                          |
| `jsdoc_tags`                          | `jsdoc-tags-createClient`                               |
| `suppressions`                        | `suppressions-orphan`                                   |
| `coverage`                            | `coverage-rows-after-ingest` (+ killer recipes)         |

Core graph tables (`files`, `symbols`, `imports`, …) are covered by many existing SQL/recipe scenarios — see `fixtures/golden/scenarios.json`.

---

## In-repo bench vs external trees

Codemap development uses **only** the committed bench ([fixtures/README.md](../fixtures/README.md)). `bun run test:golden:external` is for consumers testing against private apps — not a maintainer requirement.

## Intentionally not in bench goldens

| Surface           | Why                  | Where tested                                                |
| ----------------- | -------------------- | ----------------------------------------------------------- |
| `query_baselines` | User/session data    | `db.test.ts`, `audit-worktree.test.ts`, `cmd-audit.test.ts` |
| `recipe_recency`  | Side effect of query | `recipe-recency.test.ts`, MCP/HTTP query tests              |
| Proprietary trees | Policy               | Tier B: `test:golden:external` (gitignored goldens)         |

---

## Agent eval probes

`scripts/agent-eval/scenarios.json` — one probe per `CAPABILITIES.json` capability id (groups with `unitTests` or `enforcedBy` instead: `recipes.bundled`, `cli.bench-smoke`, `cli.mcp.http`). Each probe’s `goldenId` must appear in that group’s `goldenScenarios`; multiple substrate ids per group are fine — one matching probe is enough. Enforced by `scripts/agent-eval/capability-probes.test.mjs` in `test:scripts`.

---

## Fixture corpus

[`fixtures/minimal/README.md`](../fixtures/minimal/README.md) documents which source files exercise each parser tier. When adding a new indexed column or table, extend the fixture **and** add a golden scenario (or extend `index-table-stats`), then run `--update`.
