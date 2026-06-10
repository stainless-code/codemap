# Churn × complexity hotspots — plan

> **Status:** shipped (complete) · **Priority:** P2
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)

---

## Shipped

| Layer        | Delivered                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Moat B**   | `file_churn` table; git ingest every index pass; incremental scoped recompute; idle HEAD cache |
| **Non-git**  | `codemap ingest-churn <json>` + config `churn.file` fallback                                   |
| **Moat A**   | Recipe `churn-complexity-hotspots` — file (default) or symbol (`by_symbol=true`) grain         |
| **Scores**   | `hotspot_score` + `hotspot_score_normalized` (0–100 vs result-set max)                         |
| **Config**   | `churn.halfLifeDays`, `churn.since`, `churn.file`; CLI `--churn-since`                         |
| **Trend**    | `churn_trend`: accelerating \| stable \| cooling                                               |
| **Agent AX** | Rule trigger; `refactor-priority` + `refactor` intent cards; golden + agent-eval               |
| **Perf**     | `churn_ms` in `--performance` JSON + perf baseline gate                                        |
| **Alias**    | `hotspots` → `fan-in` unchanged (Moat-A cap)                                                   |

### Verification

```bash
bun test src/application/churn-ingest.test.ts src/application/ingest-churn-run.test.ts src/file-churn.test.ts
bun run test:golden
bun src/index.ts ingest-churn fixtures/minimal/file-churn-seed.json
bun src/index.ts query --recipe churn-complexity-hotspots --params by_symbol=true --json
```

---

## Intentionally not shipped

| Item                                  | Why                                                      |
| ------------------------------------- | -------------------------------------------------------- |
| **Repurpose `hotspots` alias**        | Moat-A alias cap; recipe is the churn×complexity surface |
| **Cross-repo absolute normalization** | `hotspot_score_normalized` is corpus-relative per query  |

---

## Key touchpoints

| File                                                                                                       | Role                                          |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| [`src/application/churn-ingest.ts`](../../src/application/churn-ingest.ts)                                 | Git ingest, trend, incremental scope, refresh |
| [`src/application/ingest-churn-run.ts`](../../src/application/ingest-churn-run.ts)                         | JSON import                                   |
| [`src/cli/cmd-ingest-churn.ts`](../../src/cli/cmd-ingest-churn.ts)                                         | `ingest-churn` verb                           |
| [`templates/recipes/churn-complexity-hotspots.sql`](../../templates/recipes/churn-complexity-hotspots.sql) | Recipe                                        |
