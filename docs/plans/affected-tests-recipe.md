# Affected tests recipe — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~1–2 weeks)
>
> **Motivator:** CI can skip full test suites if only a subgraph changed. Codemap already has `dependencies` and `test_suites` — missing a recipe + CLI alias to list test files transitively impacted by changed sources.
>
> **Roadmap:** [§ Backlog](../roadmap.md#backlog) (test-impact item) · [agent-surface-and-ops § P1](./agent-surface-and-ops.md#p1)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                             | Source                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| L.1 | **Moat-A clean** — `affected-tests` recipe satisfies the agent surface; **`query_recipe`** is the MCP/HTTP path. Optional dedicated CLI verb **`codemap affected`** for CI (`stdin` / git path discovery) — not a 6th outcome alias. | [Moat A](../roadmap.md#moats-load-bearing) |
| L.2 | Algorithm: reverse BFS on `dependencies` from changed files → filter test paths via `test_suites.file_path` and configurable globs.                                                                                                  | Uses existing substrate                    |
| L.3 | **Stdin support** — accept changed paths from `git diff --name-only` (same ergonomics as CI scripts).                                                                                                                                | CLI ergonomics                             |
| L.4 | Not a verdict — output is file paths only; CI composes exit policy.                                                                                                                                                                  | Moat A                                     |

---

## Recipe spec

**Id:** `affected-tests`

**Params (frontmatter):**

- `changed_files` — multiline or repeated (from `--params` or stdin preprocessor)
- `test_glob` — default `**/*.{test,spec}.{ts,tsx,js,jsx}`
- `max_depth` — optional cap on BFS

**SQL shape:**

1. Seed temp/changed file list (CLI pre-processes stdin into params or temp table)
2. Recursive CTE walking `dependencies` inverted (`to_path` → `from_path`)
3. JOIN `test_suites` OR glob-match `files.path`

---

## CLI verb (CI)

```bash
codemap affected --json                    # working tree vs HEAD
git diff --name-only origin/main | codemap affected --stdin --json
```

Dedicated `cmd-affected.ts` (not an outcome alias — 5-alias cap unchanged). Shipped as **`codemap affected`**, not `aliases.ts`.

## Agent surface (Moat A)

No dedicated MCP tool required — agents call **`query_recipe`** with `recipe: "affected-tests"` and `params.changed_files` (ASCII RS between paths when multiple). The recipe is the Moat-A substrate; the CLI verb is CI ergonomics only.

---

## Implementation steps

1. Recipe SQL + frontmatter + golden query fixture
2. CLI stdin handling in dedicated `cmd-affected.ts`
3. Document test-file conventions in recipe `.md`
4. Optional GitHub Action input `mode: affected` in [github-marketplace-action](./github-marketplace-action.md) (follow-up)

**Out of scope (v1):** ~~dedicated MCP/HTTP `affected` tool~~ — shipped Phase 2 follow-up (`affected` tool; same engine as CLI). `query_recipe` remains the Moat-A substrate.

---

## Phase 2 (optional, shipped)

MCP/HTTP **`affected`** — `{ paths?, changed_since?, test_glob?, max_depth? }` → shared `affected-engine` → `affected-tests` recipe. Documented in `mcp-instructions`; respects `CODEMAP_MCP_TOOLS` allowlist.

---

## Acceptance

- [x] Recipe returns test file paths for a known fixture delta
- [x] Stdin mode works in shell pipeline
- [x] Documented in README + skill

---

## Dependencies

None on schema changes. Benefits from accurate `dependencies` graph (existing).
