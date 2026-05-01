---
"@stainless-code/codemap": patch
---

`codemap audit` (B.5 v1) — structural-drift command emitting `{head, deltas}` where each `deltas[<key>]` carries `{base, added, removed}`. Three v1 deltas: `files`, `dependencies`, `deprecated`. Two snapshot-source shapes — `--baseline <prefix>` (auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` in `query_baselines`) and `--<delta>-baseline <name>` (explicit per-delta override; composes with `--baseline`). Reuses B.6 baselines; no schema bump. `--summary` collapses to per-delta counts; `--no-index` skips the auto-incremental-index prelude. v1 ships no `verdict` / threshold config — consumers compose `--json` + `jq` for CI exit codes (v1.x slice). `--base <ref>` (worktree+reindex snapshot) defers to v1.x.
