# Parametrised recipes + rename-preview — plan

> **Status:** open · M-L total effort. Ships next in the cadence after the two XS freebies (gap G + default `--watch` ON) cleared 2026-05-04. Per [`research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) Rationale 4 — orthogonal to (b) C.9 plugin layer, ships before it.
>
> **Two stacked features:**
>
> 1. **Parametrised recipes infra** (cross-cutting; M) — `?`-placeholder binding in recipe SQL + a `--params key=value,key2=value2` CLI flag + recipe `.md` frontmatter param declaration. Unblocks `delete-symbol-preview`, `extract-function-preview`, `inline-symbol-preview`, and parametrising existing static recipes (`untested-and-dead --params min_coverage=80`, etc.).
> 2. **`rename-preview` recipe + `--format diff` formatter** (consumer; S+S) — first downstream user of the infra. Bundled recipe finds rename call-sites; new `--format diff` formatter emits unified diff (read-only; never writes files). Stays moat-A-aligned (rename's choices live in reviewable recipe SQL, not argv) and inside the "no fix engine" floor (preview only — agents pipe to their own editor / `git apply --check`).
>
> **Tier:** M-L total (S+S+M-S). Plan PR opens at T+0 to iterate design before any code.

---

## Pre-locked decisions (before grilling)

These are committed to v1. Questions opened against them must justify against the linked decisions or rules.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Source                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L.1 | **No new top-level CLI verb.** Surface is `query --recipe rename-preview --params old=foo,new=bar --format diff` (composes with existing `query` verb). Mirrors `--format mermaid` discipline.                                                                                                                                                                                                                                                                                | [Moat A](../roadmap.md#moats-load-bearing) — verbs are output modes of recipes                                                                                     |
| L.2 | **Read-only output.** `--format diff` emits unified diff text to stdout / JSON. Codemap **never** writes files. Agents pipe to `git apply --check`, an editor, or their own diff applier. Bundled recipe `.md` says this in bold.                                                                                                                                                                                                                                             | [Floor "No fix engine"](../roadmap.md#floors-v1-product-shape) — borderline; this is the discipline that keeps it inside the floor                                 |
| L.3 | **Moat-A clean.** Rename's implicit choices (visibility filter, type-only re-exports, test files, aliased imports, alias-chain depth) live in reviewable recipe SQL — not argv. Agents read the SQL via `--print-sql rename-preview` to know what it does.                                                                                                                                                                                                                    | [Moat A](../roadmap.md#moats-load-bearing)                                                                                                                         |
| L.4 | **Moat-B aligned.** No new schema columns. `calls` + `imports` + `exports` + `symbols` + `type_members` already cover every shape rename-preview needs. If a column would simplify the SQL, the bar is "what other recipe does this unlock?"                                                                                                                                                                                                                                  | [Moat B](../roadmap.md#moats-load-bearing)                                                                                                                         |
| L.5 | **No JS execution at index time.** `?`-placeholder binding happens at the prepared-statement layer (`db.prepare(sql).all(...params)`); recipe SQL is still parsed-not-eval'd. Param values are typed-validated against frontmatter declaration before binding.                                                                                                                                                                                                                | [Floor "No JS execution at index time"](../roadmap.md#floors-v1-product-shape)                                                                                     |
| L.6 | **Param declaration in `.md` frontmatter** (mirrors `actions:` precedent). Loader validates incoming `--params` against the declaration: missing required → error envelope; unknown → error (strict).                                                                                                                                                                                                                                                                         | [Recipes-as-content registry shape](../glossary.md) (PR #37 precedent)                                                                                             |
| L.7 | **MCP `query_recipe` tool gains a `params` field.** Snake_case, follows existing tool input shape. Output envelope unchanged.                                                                                                                                                                                                                                                                                                                                                 | [`docs/architecture.md § MCP wiring`](../architecture.md#cli-usage)                                                                                                |
| L.8 | **Existing recipes are NOT retro-parametrised in this plan.** Static recipes that hardcode thresholds (`untested-and-dead < 80`, `worst-covered-exports LIMIT`) stay as-is. Retrofit lands as separate follow-up PRs once the infra is shipped and the param-shape conventions are stable. Avoids 3×ing this slice's blast radius.                                                                                                                                            | [`tracer-bullets`](../../.cursor/rules/tracer-bullets.mdc) — small slices                                                                                          |
| L.9 | **`--format diff` is a sibling of `--format mermaid`.** Lives in `application/output-formatters.ts`. **The formatter reads source files** (Strategy A from exploration) — recipe SQL returns `{file_path, line_start, line_end, before_pattern, after_pattern}`; formatter reads source line by line, applies the substitution, emits unified diff. Strategy B (recipe returns literal before/after text) would require a new schema column for `source_text` — violates L.4. | [Moat B](../roadmap.md#moats-load-bearing) (no schema growth for an output mode); pattern parity with `--format sarif` / `mermaid` (transport-agnostic formatters) |

---

## Open decisions (resolved 2026-05-05)

All 12 questions resolved via grill-me before any code. Each `✅ Resolved:` line is the lock-in.

- **Q1 — `--params` flag syntax.** ✅ **Resolved: (c) both supported.** `--params old=foo,new=bar` for the compact case; repeated `--params old=foo --params new=bar` for values containing `,`. **Last-write wins** on duplicate keys (matches the `--watch` / `--no-watch` last-write pattern). Split on first `=` so values containing `=` parse cleanly (`--params query=a=b` → `query` → `a=b`). If a recipe declares a param that may contain `,`, the `.md` documents "use repeated `--params` for this value". Edge cases: empty value (`--params nullable=`) → explicit empty string, not error; values containing literal `,` need the repeated form (no escape rules in v1 — keep the parser simple).
- **Q2 — Param value types.** ✅ **Resolved: `string | number | boolean`.** Frontmatter declares the target type per param; loader parses CLI string values accordingly: `type: string` → raw value; `type: number` → `Number(value)` with NaN rejection; `type: boolean` → `value === "true" || value === "1"` (anything else rejected). Recipes read naturally — `WHERE coverage_pct < ?` instead of `WHERE coverage_pct < CAST(? AS REAL)`. Type validation runs at the CLI boundary so SQLite never sees a malformed coercion. `null` / `undefined` deferred to v2 (covered for the "not provided" case via frontmatter `default: <value>` per Q3); if a recipe later needs `IS NULL` predicate, revisit with a sentinel value or a separate optional-param flag.
- **Q3 — Param declaration shape in frontmatter.** ✅ **Resolved: block-list, mirrors `actions:` precedent.** Each entry has `name` (required), `type` (`string` | `number` | `boolean`; required), `required` (boolean; default `false`), `default` (any matching `type`; only meaningful when `required: false`), `description` (string; recommended). Required default rule: `required: false` + no `default` → param is absent from the bind list (recipe SQL handles via `WHERE ? IS NULL OR ...` or omits the predicate); `default` set → loader binds it when CLI omits. Frontmatter syntax errors fail recipe load at catalog-build time; bad recipes drop out of `--recipes-json` with a clear error envelope. Example shape for `rename-preview`:
  ```yaml
  ---
  params:
    - name: old
      type: string
      required: true
      description: The symbol name being renamed
    - name: new
      type: string
      required: true
      description: The new symbol name
    - name: kind
      type: string
      required: false
      description: Optional symbols.kind filter (function / const / class / ...)
    - name: in_file
      type: string
      required: false
      description: Optional file_path prefix to narrow scope
  actions:
    - type: review-rename
      description: Pipe to git apply --check to verify; codemap never writes files
  ---
  ```
- **Q4 — Validation error envelope.** ✅ **Resolved: strict-with-suggestions.** All validation failures (missing required, unknown param, type mismatch) → exit 1 with `{error: "..."}` envelope (CLI in `--json` mode; HTTP 400; MCP `{error}` shape — same as existing unknown-recipe errors). Error messages include the declared param schema and did-you-mean suggestions to make typos visible. Strict on unknown params is the safer default (lenient mode would silently drop typos like `--params min_covrage=80`, same class of bug as the silent-truncation pattern we explicitly rejected for `--format mermaid`). Example error shapes:
  ```
  codemap query --recipe rename-preview: missing required param 'old' (string).
  Declared params: old (string, required), new (string, required),
                   kind (string, optional), in_file (string, optional).
  See `codemap query --recipes-json | jq '.[] | select(.id == "rename-preview")'` for the schema.
  ```
  ```
  codemap query --recipe untested-and-dead: --params min_coverage="eighty" is not a number.
  ```
- **Q5 — `--format diff` exact output shape.** ✅ **Resolved: two format IDs — `diff` (plain unified diff) + `diff-json` (structured envelope).**
  - `--format diff` emits pure unified diff text: `--- a/<path>` / `+++ b/<path>` headers per file, `@@ -N,M +N,M @@` per hunk, `-` / `+` lines. Pipe-ready into `git apply --check`, `patch`, editors, PR comment formatters. No header / footer comments — keeps appliers happy.
  - `--format diff-json` emits `{files: [{file_path, hunks: [{old_start, old_count, new_start, new_count, lines: [{type: "add"|"remove"|"context", text}]}]}], summary: {files, hunks, insertions, deletions}}` for agents that want structured access (apply N of M hunks; filter by file glob; etc.).
  - Both reject `--summary` / `--group-by` / baseline mode (mirrors mermaid / sarif / annotations — flat-row formatters).
  - **Why two format IDs not `--format diff --json` modifier:** `--json` currently means "JSON envelope of the rows" globally; overloading it to mean "JSON envelope of the diff structure" would mix semantics. Separate format IDs keeps everything orthogonal.
- **Q6 — Source-file reading at format time.** ✅ **Resolved: mirror `snippet`'s `{stale, missing}` envelope.** Per-file flags so agents handle the same shape they already handle for `snippet`. Detection: `before_pattern` from recipe row must appear at the indexed `line_start..line_end` range; if not → `stale: true`; if file doesn't exist → `missing: true`. Per-format behaviour:
  - **`--format diff-json`** — files with `stale` / `missing` flags appear in `files: [...]` array with the flag set + omitted hunks; `summary.skipped` increments. All info preserved for agent consumption.
  - **`--format diff`** (plain text) — stale / missing files become `# WARNING: <path> stale at index time; re-index and re-run` comment lines at the **top** of the diff (before any `--- a/...` headers, where appliers tolerate comments). Plus stderr warning for visibility. Files that aren't stale render normally.
  - **Binary / unindexed files** — recipe SQL shouldn't return them (they're filtered at extraction time per `src/runtime.ts isPathExcluded`); if one slips through, formatter treats it as `missing` (file not readable as text → skip with flag).
- **Q7 — `rename-preview` SQL — alias-chain depth.** ✅ **Resolved: recursive CTE, cap = 5, cycle-detected.** Real codebases rename across barrels (`react` → `@my/ui` → `@my/components` → consumer is a 3-hop chain that's normal in monorepos); no-chain or one-hop misses obvious cases. Recursive CTE pattern mirrors `impact-engine.ts` (walks `dependencies` recursively with depth cap + `instr(path_string, file_path) > 0` cycle detection). Cap = 5 is empirically generous (covers ~99% of barrel chains seen in real codebases). Each rename location row carries a `chain_depth` field so agents can post-filter (e.g. only direct call sites via `WHERE chain_depth = 0`). **Known false-negative documented in `.md`:** alias-rename through anonymous re-exports (`export *`) cannot be tracked without import-resolution data we don't extract — recipe surfaces direct rename targets only for those barrels.
- **Q8 — `rename-preview` SQL — caller-scope filter.** ✅ **Resolved: narrowing-params shape, visibility filter automatic in SQL.** Recipe takes 4 optional params plus the 2 required (`old` + `new`):
  - `kind` (string, optional) — filter by `symbols.kind` (`function` / `const` / `class` / `type` / `interface` / ...)
  - `in_file` (string, optional) — `file_path` prefix narrowing for monorepo / sub-tree scoping
  - `include_tests` (boolean, default `true`) — include test files in the rename diff
  - `include_re_exports` (boolean, default `true`) — follow `re_export_source` chain per Q7 cap

  **Visibility filter is moat-A logic baked into the SQL** (not a param) per L.3: if the symbol's own `symbols.visibility` is `'internal'` / `'private'`, the recipe automatically narrows to within the owning package; if `'public'` (or unset), all consumers. Agents read `--print-sql rename-preview` to verify the discipline. Updates the example frontmatter shape from Q3 to include all 4 optional params.

- **Q9 — `rename-preview` SQL — string literal & comment caveat.** ✅ **Resolved: stderr warning + `.md` caveat; recipe stays structural-only.** Recipe ignores `markers` (TODOs / NOTEs may mention `?old` but match-by-substring would over-fire false positives). Formatter (when `recipe_id == "rename-preview"` and `--format diff` / `diff-json`) appends a stderr-only warning so it doesn't pollute the diff stdout that pipes to `git apply`:
  ```
  # Note: rename-preview covers structural references only.
  # Not covered: string literals (`"oldName"`), comments (`// renamed oldName`),
  # dynamic dispatch (`obj[name]`), template-literal property access.
  # Search separately: rg --type ts 'oldName' --glob '!node_modules'
  ```
  **Generalisation:** the warning text comes from a new optional `format_warning:` frontmatter field (with `format:` filter — e.g. `format_warning.diff: "..."`). Future preview recipes (`delete-symbol-preview`, etc.) reuse the mechanism without per-formatter conditionals.
- **Q10 — MCP `query_recipe` params field shape.** ✅ **Resolved: nested object.** `{recipe: "rename-preview", params: {old: "foo", new: "bar", include_tests: true}}`. Snake_case throughout. Avoids the collision risk of flat-keys (future top-level tool flags like `summary` / `changed_since` could shadow recipe params), avoids the verbosity of positional pair lists. Zod schema at MCP boundary validates `params` against the recipe's frontmatter declaration → same error envelope as the CLI (Q4 strict-with-suggestions). HTTP `POST /tool/query_recipe` body uses the identical shape.
- **Q11 — Error mode when source files have moved.** ✅ **Resolved: formatter-only handling per Q6; no recipe-layer changes.** Recipe SQL trusts the index; the formatter's per-file `stale` / `missing` flags (Q6) surface staleness at the right granularity. Recipe-self-check would force schema growth (an `is_stale` column for purely an output-mode concern — fails Moat B's "what recipe does this kill?" test). Advise-reindex via a freshness row would break the `{file_path, line_start, ...}` shape `--format diff` expects. Defence in depth: agents pipe through `git apply --check` regardless; `git` rejects stale patches. Recipe `.md` says "re-index before applying if you've made local edits since the last `bun src/index.ts`".
- **Q12 — Tests for v1.** ✅ **Resolved: unit-plus-fixture.** Per-slice coverage:
  - **Slice 1** — `--params` parser unit tests (Q1 edge cases: comma-split, repeated, equals form, last-write); type validation (Q2: string/number/boolean coercion + NaN rejection); frontmatter declaration parsing (Q3); error envelopes (Q4); golden-query against `fixtures/minimal/` for the `find-symbol-by-kind` exemplar recipe; MCP integration test for `query_recipe` with `params`; HTTP `POST /tool/query_recipe` with `params`.
  - **Slice 2** — formatter unit tests on synthetic rows (multi-hunk single file; multiple files; missing file → flag; stale line range → flag; binary file slip-through); CLI integration with `--format diff` + `--format diff-json`; HTTP `POST /tool/query` with `format: "diff"`.
  - **Slice 3** — golden-query against extended `fixtures/minimal/` rename scenario (1-2 extra fixture files for a non-trivial rename); `--format diff` snapshot test on recipe output; `chain_depth` ordering test (Q7).
  - **Skip:** load testing, fuzz testing on `--params`, e2e with temp git repos (`git apply --check` is well-tested elsewhere; we just need to produce a valid diff). Out of scope for v1.

---

## Slices (tracer-bullet order)

Each slice is one PR. Verify after each per [`verify-after-each-step`](../../.cursor/rules/verify-after-each-step.mdc).

### Slice 1 — Parametrised recipes infra (S+, ~150-250 LoC)

**Goal:** ship the `?`-binding pipeline end-to-end via one trivial parametrised recipe; no `rename-preview` yet.

**Surface area:**

- New flag `--params key=value[,key2=value2]` parser in `src/cli/cmd-query.ts`.
- Frontmatter `params:` declaration in `src/application/recipes-loader.ts` (validated; types per Q2).
- Validation: incoming `--params` matched against declaration; missing required → error; unknown → strict reject (per L.6 / Q4).
- `executeQuery` / `executeQueryRecipe` accept a `params` array; pass to `db.prepare(sql).all(...params)`.
- MCP `query_recipe` tool gains a `params` field (Q10).
- HTTP `POST /tool/query_recipe` mirrors the MCP shape.
- One trivial bundled parametrised recipe to prove the path — `find-symbol-by-kind.sql` with `?kind` + `?name_pattern`:
  ```sql
  SELECT name, file_path, line_start, signature
  FROM symbols
  WHERE kind = ?
    AND name LIKE ?
  ORDER BY file_path, line_start;
  ```
- Bundled `.md` frontmatter declares the params, demonstrates the shape.

**Tests:** `--params` parsing edge cases (missing, unknown, type mismatch); recipe execution with params; MCP tool call with `params: {}` field; HTTP POST with `params`.

**Lockstep:** `templates/agents/rules/codemap.md` + `.agents/rules/codemap.md` mention the new `--params` flag + frontmatter shape; `templates/agents/skills/codemap/SKILL.md` + `.agents/skills/codemap/SKILL.md` document the param-flag examples.

**Changeset:** minor.

**Verification:**

```bash
bun src/index.ts query --recipe find-symbol-by-kind --params kind=function,name_pattern=%Symbol%
bun src/index.ts query --recipes-json | jq '.[] | select(.id == "find-symbol-by-kind") | .params'
bun run check
```

### Slice 2 — `--format diff` formatter (S, ~100-200 LoC)

**Goal:** ship the diff formatter against an ad-hoc SQL query that returns `{file_path, line_start, line_end, before_pattern, after_pattern}` rows. No `rename-preview` recipe yet — synthetic fixture exercises the formatter.

**Surface area:**

- New formatter `formatDiff` in `src/application/output-formatters.ts`. Sibling of `formatMermaid` / `formatSarif` / `formatAnnotations`.
- Reads source files at format time (Strategy A per L.9); error envelope for missing / stale files (Q6, Q11).
- Output: pure unified diff (Q5 default); JSON envelope option for agents (`{file_path, hunks: [...]}`) if Q5 grilling lands there.
- CLI accepts `--format diff` for `query` / `query --recipe` (formatter is a flat row consumer; rejects `--summary` / `--group-by` / baseline mode like the others).
- HTTP `POST /tool/query` and `query_recipe` accept `format: "diff"` (mirrors `mermaid`).

**Tests:** unit tests on synthetic rows (file with simple substitution; multi-hunk file; missing file → error envelope; stale line range → warning); CLI integration test against `fixtures/minimal/`.

**Lockstep:** README / agent rules mention `--format diff` alongside `mermaid` / `sarif` / `annotations`.

**Changeset:** minor.

**Verification:**

```bash
bun src/index.ts query --format diff "SELECT 'src/foo.ts' AS file_path, 42 AS line_start, 42 AS line_end, 'oldName' AS before_pattern, 'newName' AS after_pattern"
bun run check
```

### Slice 3 — `rename-preview.sql` recipe (S, ~50-150 LoC SQL + `.md`)

**Goal:** the deliverable. Bundled recipe that uses Slice 1 + Slice 2.

**Surface area:**

- `templates/recipes/rename-preview.sql` — params: `?old`, `?new`, optional `?kind`, optional `?in_file`. Returns `{file_path, line_start, line_end, before_pattern, after_pattern, location_kind}` where `location_kind ∈ {definition, call_site, import_specifier, type_member, re_export}`.
- `templates/recipes/rename-preview.md` — frontmatter declares params; body explains the matrix of locations covered + the substrate-can't-find caveats (string literals, comments, dynamic dispatch). Bold "**Read-only — codemap never writes files**" warning.
- Project-local override path documented (users tune the recipe's caller-scope filter / alias-chain depth via a copy in `<projectRoot>/.codemap/recipes/`).

**Tests:** golden query on `fixtures/minimal/` rename scenario; `--format diff` integration tests on the recipe output.

**Lockstep:** `templates/agents/skills/codemap/SKILL.md` + `.agents/skills/codemap/SKILL.md` add a "rename-preview" example to the recipe-usage section.

**Changeset:** minor.

**Verification:**

```bash
bun src/index.ts query --recipe rename-preview --params old=oldName,new=newName --format diff
bun src/index.ts query --recipe rename-preview --params old=oldName,new=newName --json | jq '.[].location_kind' | sort -u
bun run check
```

---

## Risks / open follow-ups

- **Composition cliff:** rename-preview only catches **structural** rename targets (call sites, imports, re-exports, type members, definitions). String literals, comments, dynamic dispatch (`obj[name]`), template-literal property access — all invisible to the substrate. Recipe `.md` must say this clearly enough that agents don't ship "renamed everywhere" claims.
- **Source-text drift:** if the index is stale relative to disk, the formatter's `before_pattern` substitution may apply at the wrong line. `--format diff` should surface a `stale: true` flag per file (mirror of `snippet`'s envelope) so agents can re-index before applying.
- **Retrofit expectations:** Slice 1 lands the infra but doesn't retroactively parametrise existing static recipes. Land follow-up PRs ad-hoc as agents request specific thresholds (bias toward "wait for ask, not speculation" per the `verdict + thresholds` deferral pattern).
- **MCP parameter-validation surface:** `params` field gets Zod-validated at the MCP boundary against the recipe's frontmatter declaration. New shape — review before ship.
- **Consumer-test coverage:** golden tests on `fixtures/minimal/` — does the fixture have a non-trivial rename scenario? May need to add one (small fixture extension).

---

## Cross-references

- [`research/non-goals-reassessment-2026-05.md § 1.10`](../research/non-goals-reassessment-2026-05.md#1-shipped-since-this-inventory-appendix) — original capability description (item 1.10; pending pick).
- [`roadmap.md § Backlog`](../roadmap.md#backlog) — backlog one-liner that motivated this plan.
- [`roadmap.md § Non-goals (v1) → Floors`](../roadmap.md#floors-v1-product-shape) — "No fix engine" floor that L.2 / L.3 keep us inside of.
- [`docs/README.md` Rule 10](../README.md#rules-for-agents) — agent rule + skill lockstep update.
- [`tracer-bullets`](../../.cursor/rules/tracer-bullets.mdc) — slice cadence.
- [`verify-after-each-step`](../../.cursor/rules/verify-after-each-step.mdc) — per-slice check discipline.
