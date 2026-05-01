---
"@stainless-code/codemap": minor
---

`codemap query --save-baseline` / `--baseline` — snapshot a query result set and diff against it later. Stored in the new `query_baselines` table inside `.codemap.db` (no parallel JSON files). `--baselines` lists saved snapshots, `--drop-baseline <name>` deletes one. Diff identity is per-row `JSON.stringify` equality; `--summary` collapses to `{added: N, removed: N}`. Recipe `actions` attach to the `added` rows when running under `--baseline`. Baselines survive `--full` and SCHEMA rebuilds. `SCHEMA_VERSION` bumps from 4 to 5.
