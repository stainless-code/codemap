---
params:
  - name: row_limit
    type: number
    required: false
    default: 20
    description: Maximum rows to return (default 20)
  - name: min_complexity
    type: number
    required: false
    default: 1
    description: Minimum cyclomatic complexity (default 1)
  - name: by_symbol
    type: boolean
    required: false
    default: false
    description: When true, one row per symbol; default false ranks files (max complexity in-file)
---

# churn-complexity-hotspots

Files or symbols ranked by **git churn × cyclomatic complexity**. Distinct from the outcome alias `codemap hotspots` (import **fan-in** via `fan-in` recipe).

Populated on every index pass from `git log --numstat` (config `churn.halfLifeDays`, `churn.since` / `--churn-since`). Non-git repos: `codemap ingest-churn <file.json>` or config `churn.file`.

```bash
codemap query --recipe churn-complexity-hotspots
codemap query --recipe churn-complexity-hotspots --params min_complexity=10,row_limit=10
codemap query --recipe churn-complexity-hotspots --params by_symbol=true
codemap ingest-churn churn-metrics.json
```

`hotspot_score` = `weighted_commits × complexity`. `hotspot_score_normalized` is 0–100 vs the corpus max in the result set. Triage with `snippet` before large refactors.
