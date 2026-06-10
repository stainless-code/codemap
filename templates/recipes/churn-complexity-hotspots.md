---
actions:
  - type: review-churn-hotspot
    auto_fixable: false
    description: "High git churn × cyclomatic complexity — read source with snippet; check fan-in before refactor. Not the codemap hotspots alias (import fan-in)."
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
  - name: path_prefix
    type: string
    required: false
    default: ""
    description: Limit to files under this path prefix (e.g. src/lib/)
---

# churn-complexity-hotspots

Files or symbols ranked by **git churn × cyclomatic complexity**. Distinct from the outcome alias `codemap hotspots` (import **fan-in** via `fan-in` recipe).

Populated on every index pass from git history (config `churn.halfLifeDays`, `churn.since` / `--churn-since`). Non-git repos: `codemap ingest-churn <file.json>` or config `churn.file`.

```bash
codemap query --recipe churn-complexity-hotspots
codemap query --recipe churn-complexity-hotspots --params min_complexity=10,row_limit=10
codemap query --recipe churn-complexity-hotspots --params by_symbol=true
codemap query --recipe churn-complexity-hotspots --params path_prefix=src/lib/
codemap ingest-churn churn-metrics.json
```

`hotspot_score` = `weighted_commits × complexity`. `hotspot_score_normalized` is 0–100 vs the corpus max in the result set.

**Output columns:** shared — `file_path`, `weighted_commits`, `commit_count`, `churn_trend`, `hotspot_score`, `hotspot_score_normalized`. File grain (`by_symbol=false`, default) — `symbol_name`/`symbol_kind`/`line_start` null; `max_complexity`, `avg_complexity`. Symbol grain (`by_symbol=true`) — `symbol_name`, `symbol_kind`, `line_start`; `max_complexity` = symbol complexity. `churn_trend` is `accelerating`, `stable`, or `cooling` when enough history exists.

**Ingest JSON** (`ingest-churn` / `ingest_churn` / `churn.file`): array of `{file_path, commit_count, weighted_commits, lines_added?, lines_removed?, last_commit_at?, churn_trend?, computed_at?}` — indexed paths only.

Triage with `snippet` before large refactors.
