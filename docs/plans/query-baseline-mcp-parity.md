# Query baseline compare — MCP/HTTP parity — plan

> **Status:** open · **Priority:** P1 (transport parity) · **Effort:** S (~1 day)
>
> **Motivator:** CLI `codemap query --baseline=<name>` diffs current rows vs `query_baselines` in one call. MCP has `save_baseline` / `list_baselines` / `drop_baseline` but not inline compare on `query` / `query_recipe`.
>
> **Roadmap:** transport parity (agent-relevant core)

---

## Pre-locked decisions

| #   | Decision                                                                                                                       | Source                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| B.1 | **Extend existing tools** — add optional `baseline: string` to `query` and `query_recipe`; no new tool.                        | Moat A — recipes stay the API    |
| B.2 | **Same envelope** as CLI `--json --baseline`: `{baseline, current_row_count, added, removed}`; `summary: true` → count fields. | `cmd-query.ts` `runBaselineDiff` |
| B.3 | **Recipe `actions` on `added` rows only** — same as CLI.                                                                       | Apply discover loop              |
| B.4 | **Reject combos** — `baseline` + `format` (sarif/annotations/mermaid/diff/diff-json) or `group_by`; mirrors CLI parser.        | Output-shape contract            |
| B.5 | **Engine** — `application/query-baseline.ts` (`compareQueryBaseline`); shared by MCP handlers (CLI refactor optional later).   | Layering                         |

---

## Implementation steps

1. Add `compareQueryBaseline` in `application/query-baseline.ts` (uses `diffRows`, `getQueryBaseline`, `filterRowsByChangedFiles`)
2. Wire `baseline?: string` into `queryArgsSchema` / `queryRecipeArgsSchema`
3. Early branch in `handleQuery` / `handleQueryRecipe` before `executeQuery` / formatted paths
4. Tests: `query-baseline.test.ts` + `tool-handlers.test.ts` baseline diff case
5. Update MCP tool descriptions + `templates/agent-content/mcp-instructions.md`

---

## Acceptance

- [x] `query_recipe` + `baseline` + `summary` returns `{added: N, removed: N}` counts
- [x] `query_recipe` + `baseline` returns full diff with `actions` on `added` when recipe declares them
- [x] Missing baseline name → `{error}` envelope
- [x] `baseline` + `format: sarif` → error (incompatible)
