# Scoped rename (`define_in` on `rename-preview`)

**Status:** Open — tracer-bullet implementation.  
**Effort:** S (recipe + goldens + CLI e2e); +S optional `codemap rename` write alias.  
**Motivation:** Agents need homonym-safe renames; `find-symbol-references` already anchors on definition `file_path`, but `rename-preview` keys on **name only** and `call_rows` match **every** `callee_name`.

**Canonical homes after merge:** lift param semantics + agent workflow into [`architecture.md` § Apply](../architecture.md#apply--input-modes-transport-and-policy) and [`glossary.md` § codemap apply](../glossary.md#codemap-apply--apply-tool); delete this plan.

---

## Problem

| Today                                                             | Gap                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `rename-preview` `old` selects **all** `symbols` with that name   | Two `function helper()` in different files both rename                                                |
| `in_file` filters **output row** `file_path` prefixes             | Does **not** limit `target_symbols`; imports outside prefix still resolve to out-of-scope definitions |
| `call_rows` uses `callee_name = old` only                         | Homonym call sites bleed across modules                                                               |
| `find-symbol-references` uses `name` + **definition** `file_path` | Precise read path; apply path does not mirror it                                                      |

**Agent failure mode:** `codemap apply rename-preview --params old=helper,new=worker --yes` rewrites the wrong module or every `helper()` call in the repo.

---

## Goal

| Audience        | Outcome                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| **Agents**      | One param anchors rename to **one definition file** (same mental model as `find-symbol-references`) |
| **Humans**      | Optional `codemap rename` alias after recipe proves out (Moat A thin wrapper)                       |
| **Maintainers** | Golden + `cmd-apply` e2e proving homonym isolation; no new apply engine                             |

---

## Design

### Param: `define_in`

| Field          | Value                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**       | `define_in` (distinct from `in_file` — definition anchor vs usage prefix)                                                                                                                                                      |
| **Type**       | optional `string`                                                                                                                                                                                                              |
| **Semantics**  | When set: `target_symbols` ⊆ `{ s \| s.name = old AND s.file_path = define_in }` (project-relative path, **exact** match on `symbols.file_path` after canonicalization — same discipline as `show --in` / recipe path filters) |
| **When unset** | Current behavior unchanged (all homonyms in scope)                                                                                                                                                                             |

**Do not** overload `in_file` for this — existing SQL documents that `in_file` intentionally does not filter `target_symbols` (barrel/import rows for symbols defined outside the prefix).

### `call_rows` when `define_in` is set

**Verdict (ship in v1):** Replace name-only `call_rows` with **binding-resolved** call sites for the anchored symbol set.

- Join `calls` to `bindings` / `references` / `target_symbols` where `callee_name = old` **and** the reference at `(file_path, line_start)` resolves to `b.resolved_symbol_id ∈ target_symbols.id`.
- When `define_in` is unset: keep existing `call_rows` CTE (backward compatible).

**Rejected for v1:** Leave `call_rows` as global `callee_name` even when `define_in` is set — fails the homonym e2e.

### Other CTEs

| CTE                                | When `define_in` set                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `definition_rows`                  | Only definitions in `target_symbols` (already implied)            |
| `import_rows`                      | Unchanged join via `resolved_path = s.file_path` for anchored `s` |
| `reference_rows`                   | Already `JOIN target_symbols s ON s.id = b.resolved_symbol_id`    |
| `re_export_*`, `barrel_*`, `jsx_*` | Already tied to `target_symbols`                                  |

### Moat A / policy

- Still `rename-preview` recipe + `apply`; no new engine.
- `auto_fixable: true` unchanged.
- Update `actions[].command` on read recipes to document optional `define_in={{file_path}}` where placeholders allow (C.6 pattern).

### Optional write alias (Phase 2 — same PR or follow-up)

Cap write aliases at **3–5** (read aliases capped at 5 in `src/cli/aliases.ts`).

```bash
codemap rename <old> <new> [--define-in <path>] [--kind …] [--dry-run | --yes] …
# ≡ codemap apply rename-preview --params old=…,new=…[,define_in=…] …
```

Implement via new `WRITE_ALIASES` / `resolveWriteAlias` in `src/cli/aliases.ts` (or `cmd-rename.ts` delegating to `runApplyCmd`) — **not** a sixth read outcome alias.

**Defer:** MCP tool `rename_symbol` until CLI + recipe param ship; can be same PR if trivial wrapper over `handleApply`.

---

## Execution phases

### Phase 1 — Recipe + docs (tracer bullet)

| Step | Action                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `templates/recipes/rename-preview.sql` — add `define_in` to `params` CTE; filter `target_symbols`; binding-scoped `call_rows` when `define_in IS NOT NULL` |
| 1.2  | `templates/recipes/rename-preview.md` — param frontmatter, homonym workflow, contrast `in_file` vs `define_in`                                             |
| 1.3  | `find-symbol-definitions` / `find-symbol-references` frontmatter — `actions[].command` example with `define_in=` or cross-link                             |
| 1.4  | `templates/agent-content/skill/10-recipes-context.md` — agent rule: homonyms → `define_in` or `find-symbol-references` first                               |

### Phase 2 — Verification

| Step | Action                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | **Bench corpus** — two same-named functions in different files under `fixtures/minimal/src/bench/` (e.g. `homonym-helper-a.ts`, `homonym-helper-b.ts` + consumer that imports only one) |
| 2.2  | **Golden** — `rename-preview-homonym-scoped` in `fixtures/golden/scenarios.json` + `fixtures/golden/minimal/rename-preview-homonym-scoped.json`                                         |
| 2.3  | **`cmd-apply.test.ts`** — full index; apply with `define_in` touches only anchored file + its importers; sibling homonym unchanged                                                      |
| 2.4  | **Regression** — existing `rename-preview` goldens unchanged when `define_in` omitted (`bun run test:golden`, targeted `bun test`)                                                      |

### Phase 3 — Optional CLI alias

| Step | Action                                                                            |
| ---- | --------------------------------------------------------------------------------- |
| 3.1  | `codemap rename` → `apply rename-preview` delegation; `--help`; `aliases.test.ts` |
| 3.2  | `bootstrap.ts` help line; README one-liner under apply (consumer surface)         |

---

## Agent workflow (target)

```bash
# 1. Disambiguate
codemap query --recipe find-symbol-definitions --params name=helper --json
# or: codemap show helper --json

# 2. Preview scoped rename
codemap query --recipe rename-preview \
  --params old=helper,new=worker,define_in=src/bench/homonym-helper-a.ts \
  --format diff-json

# 3. Apply
codemap apply rename-preview \
  --params old=helper,new=worker,define_in=src/bench/homonym-helper-a.ts \
  --yes --json
```

Pair with [`find-symbol-references`](../../templates/recipes/find-symbol-references.md) (`name` + definition `file_path`) before apply when blast radius is unclear.

---

## Preserved constraints

- **Moat A:** No curated rename logic in a new engine — SQL + existing `applyDiffPayload` only.
- **Moat B:** No schema change required for v1 (uses existing `symbols`, `bindings`, `calls`, `references`).
- **Same-line ambiguity:** Unchanged — first `before_pattern` match per line; `ambiguity_count` on `diff-json` still applies.
- **No global rename verb without anchor** — docs must warn: bare `old`/`new` remains union-of-homonyms.

---

## Non-goals (this plan)

| Item                               | Why                                                              |
| ---------------------------------- | ---------------------------------------------------------------- |
| `symbols.id` param                 | Defer unless `define_in` insufficient (e.g. overloads same file) |
| AST / LSP rename                   | [`roadmap.md` § Non-goals](../roadmap.md#non-goals-v1)           |
| `codemap fix` dispatcher           | Separate roadmap item; not bundled here                          |
| Auto-infer `define_in` from `show` | Agent host / `context` responsibility                            |

---

## Success criteria

- [ ] With `define_in` set, golden + e2e show **zero** edits to the sibling homonym file.
- [ ] With `define_in` unset, existing rename-preview goldens pass.
- [ ] Skill/MCP text states homonym policy in one place.
- [ ] Optional: `codemap rename --define-in` documented and tested.

---

## Cross-references

| Doc                                                                                                                 | Role                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [`substrate-apply-utilization.md`](./substrate-apply-utilization.md)                                                | Apply wave complete; delete on merge |
| [`research/codemap-richer-index-synthesis-2026-05.md` § 3.1](../research/codemap-richer-index-synthesis-2026-05.md) | Curated verbs deferred; trigger met  |
| [`testing-coverage.md`](../testing-coverage.md)                                                                     | Update apply table row after ship    |
| [`fixtures/minimal/README.md`](../../fixtures/minimal/README.md)                                                    | Homonym corpus note                  |

---

## Lifecycle

- **On ship:** Lift `define_in` / homonym workflow to architecture + glossary; add roadmap [x] item; **delete** this plan.
- **If `call_rows` design forks in review:** Record decision in PR thread only — do not spawn a second plan file.
