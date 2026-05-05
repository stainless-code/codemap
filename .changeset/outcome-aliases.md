---
"@stainless-code/codemap": patch
---

Outcome-shaped CLI aliases — five thin top-level verbs that wrap `query --recipe <id>`:

- `codemap dead-code` → `query --recipe untested-and-dead`
- `codemap deprecated` → `query --recipe deprecated-symbols`
- `codemap boundaries` → `query --recipe boundary-violations`
- `codemap hotspots` → `query --recipe fan-in`
- `codemap coverage-gaps` → `query --recipe worst-covered-exports`

Every `query` flag passes through (`--json`, `--format sarif|annotations|mermaid|diff|diff-json`, `--ci`, `--summary`, `--changed-since <ref>`, `--group-by owner|directory|package`, `--params key=value`, `--save-baseline`, `--baseline`). Run `codemap <alias> --help` for the wrapped recipe id.

Closes the verb-obviousness gap — `codemap dead-code` is more discoverable than `codemap query --recipe untested-and-dead`. Capped at five to avoid alias-sprawl per [`roadmap.md`](../docs/roadmap.md); promote a sixth only when the recipe becomes a headline outcome.

Mapping lives in `src/cli/aliases.ts` (`OUTCOME_ALIASES`); rewrite happens before dispatch in `src/cli/main.ts`. Pure CLI surface; no schema, no engine, no new substrate. Moat-A clean — the alias is a one-line `query --recipe <id>` rewrite, not a new primitive; the recipe IS the SQL.
