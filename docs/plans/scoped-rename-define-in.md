# Scoped rename (`define_in`) — plan

> **Status:** ready to delete · **Priority:** P1 · **Effort:** S (alias slice) + M (shipped in [#165](https://github.com/stainless-code/codemap/pull/165))
>
> **Motivator:** Homonymous symbol names make bare `rename-preview` union every `symbols.name` match. Agents need the same definition anchor `find-symbol-references` uses (`file_path` of the definition).
>
> **Roadmap:** [§ Backlog — Agent & indexing ops](../roadmap.md#agent--indexing-ops)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                | Source                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| R.1 | **`define_in` scopes `target_symbols`** to `symbols.file_path = define_in`; binding-resolved `call_rows` / JSX CTEs filter when set.                    | Moat B — substrate                                                                 |
| R.2 | **`in_file` stays output-only** — prefix filter on result row paths; does not pick which homonym is the rename target.                                  | [rename-preview.md](../../templates/recipes/rename-preview.md)                     |
| R.3 | **Moat A preserved** — no new verdict engine; optional `codemap rename` is a **thin alias** → `apply rename-preview` (same as outcome aliases → query). | [architecture § Apply](../architecture.md#apply--input-modes-transport-and-policy) |
| R.4 | **Golden + apply e2e** — `rename-preview-homonym-scoped` / `rename-preview-homonym-unscoped` in `fixtures/golden/minimal/`.                             | [testing-coverage.md](../testing-coverage.md)                                      |

---

## Shipped ([#165](https://github.com/stainless-code/codemap/pull/165))

- [x] `define_in` recipe param on `rename-preview` (`templates/recipes/rename-preview.{sql,md}`)
- [x] Binding-scoped `call_rows` + `jsx_element_rows` / `jsx_closing_rows` when `define_in` set
- [x] Golden `rename-preview-homonym-scoped` + homonym fixtures under `fixtures/minimal/src/bench/`
- [x] `cmd-apply.test.ts` homonym apply e2e
- [x] Agent surfaces: README, skill, MCP instructions, `find-symbol-references` action template

---

## Remaining slice (this PR)

- [x] **`codemap rename` CLI alias** — rewrite to `codemap apply rename-preview` with full apply flag pass-through
- [x] Positional ergonomics: `codemap rename <old> <new> [--define-in path] [--in-file prefix] [--kind k]`
- [x] `rename-alias.test.ts` + integration via `cmd-apply.test.ts`
- [x] `bootstrap.ts` help line; roadmap checkbox for alias

**Non-goals (unchanged):** global rename verb with new semantics; MCP `rename` tool; AST apply engine.

---

## Acceptance

- [x] Scoped golden matches binding-resolved call sites only for anchored homonym
- [x] Unscoped golden unions both homonyms
- [x] `codemap rename helper worker --define-in src/bench/homonym-helper-a.ts --yes` ≡ apply recipe path
- [x] `codemap rename --help` documents alias + `define_in` vs `in_file`

---

## Delete trigger

Delete this plan when the alias slice merges and roadmap item is fully checked — lift one-liner to [architecture § Homonym-safe rename](../architecture.md#apply--input-modes-transport-and-policy).
