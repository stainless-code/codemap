# Apply-engine direction — diff-shape recipes + agent-in-the-loop substrate

> **Status:** open · substrate growth (Steps 5–7 partial) lives in [`substrate-extraction.md`](./substrate-extraction.md) (tiers 1–6 shipped). This plan owns the **apply-engine / diff-shape recipe** half of the richer-index synthesis.
>
> **Motivator:** extend `codemap apply` from recipe-driven single-file hunks toward agent-in-the-loop row contracts (`apply --rows -`, diff-input, fixpoint loops) without crossing [Moat A](../roadmap.md#moats-load-bearing) (SQL/recipe API) or [Moat B](../roadmap.md#moats-load-bearing) (no re-extraction in apply).
>
> **Source:** consolidated from [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) § 6–8 (lifted 2026-05). Full triangulation matrices remain in that research note until all steps close.

---

## Shipped (do not re-litigate)

| Step          | Work                                                                 | Canonical home                                                                                                           |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1             | Doc reframe (Floors split; apply vs verdict lints)                   | [`roadmap.md § Floors`](../roadmap.md#floors-v1-product-shape), [`why-codemap.md`](../why-codemap.md)                    |
| 5             | `calls.{line_start, column_start, column_end}` + call-shape metadata | [`substrate-extraction.md` Tier 1.A](./substrate-extraction.md), [`architecture.md § Schema`](../architecture.md#schema) |
| 7 (substrate) | `exports` position columns + `re_export_chains`                      | [`substrate-extraction.md` Tiers 1.B / 2.2](./substrate-extraction.md)                                                   |

---

## Open steps (implementation sequence)

### Step 2 — Three diff-shape recipes (S × 3)

Ship `replace-marker-kind`, `migrate-import-source`, `add-jsdoc-deprecated` — pure SQL + frontmatter; no engine/schema change.

Open: sequential PRs per [tracer-bullets](../../.agents/rules/tracer-bullets.md); hold `organize-imports` / `missing-exports` for wave 2.

### Step 3 — Per-row `actions[].command` template (S)

Extend `recipes-loader.ts` / `query-recipes.ts` so `actions[]` carries a rendered `command` template (reuse `recipe-params.ts`; block-list shape only).

### Step 4 — `auto_fixable` gating (S)

Enforce `actions[].auto_fixable: true` (or `--force`) before write. `--force` bypasses gate only, not phase-1 conflict detection.

### Step 6 — App-wide rename recipe (S; depends Step 5 substrate ✓)

Extend `rename-preview.sql` with `call_rows` CTE. Bias: extend existing recipe id, not a second rename recipe. Preserve honest v1 gap list (re-exports, JSX, default-import binds).

### Step 7 (recipe) — `rename-preview` `re_export_rows` CTE (S)

Substrate shipped; **recipe extension open**. Single-hop alias chains in v1; recursive CTE if gap appears.

### Step 8 — `apply --rows -` + `apply_rows` MCP/HTTP tool (M)

JSON array of `{file_path, line_start, before_pattern, after_pattern}` from stdin/args; existing phase-1/2 validation. Separate MCP tool (not polymorphic with recipe id).

### Step 9 — `apply --diff-input <file>` (S)

Unified diff → row contract → same engine. Hand-roll parser; per-file atomicity; cross-file rollback deferred.

### Step 10 — `apply --commit "<msg>"` (S)

`git add` only files apply touched, then commit. Message templating deferred.

### Step 11 — `--until-empty` + `--max-passes N` (S)

Apply → reindex → re-run recipe loop. Abort whole loop on phase-1 conflicts. Extend result envelope with `passes` + `terminated_by`.

### Step 12 — `apply.autoApplyRecipes` allowlist (S)

Config list of recipe ids allowed with `--yes` without interactive confirm. `--force` bypasses allowlist.

---

## Preserved moats (apply path)

- No `severity` on apply rows — recipes propose; codemap executes.
- No suppression-by-default — existing `codemap-ignore-*` substrate only.
- No JS execution at apply time — rows are static data; never `eval`.
- No codemod-tool ambition — SQL API + substrate executor; AST work stays Path B / external tools.
- No telemetry upload — reliability metrics stay local/opt-in per [`roadmap.md § Floors`](../roadmap.md#floors-v1-product-shape).

The "no fix engine" floor was about **product class** (no ESLint-style verdict engine), not forbidding a **substrate-shaped** apply executor.

---

## Rejected items (grep-able; revisit only on trigger)

| Item                                              | Why rejected                                           | Revisit when                                                               |
| ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Curated CLI write verbs (`codemap rename`, …)     | Moat A — premature verb sprawl                         | ≥3 diff-shape recipes + clear agent-host demand beyond `actions[].command` |
| Parallel AST apply engine (Path A)                | Competes with ts-morph/jscodeshift; maintenance burden | ≥2 external teams hit substring wall + concrete AST-shape demand           |
| Trust tiers (`safe`/`review`/`risky`)             | Taxonomy debt; `auto_fixable` + allowlist suffice      | Allowlist insufficient + ≥2 consumers ship trust filters in CI             |
| Per-row confidence scores                         | No consensus on computation                            | Recipe needs per-site ranking when `before_pattern` is ambiguous           |
| Verifier as product surface (typecheck/lint gate) | Consumer CI owns orchestration                         | Consumer plan with concrete examples                                       |
| Reliability loop telemetry                        | No upload floor                                        | Self-hosted observability request                                          |
| `--branch` / `--output-patch` flags               | `--commit` priority                                    | `--commit` insufficient in practice                                        |
| Multi-line kind-tagged row contract               | After single-line path stable                          | Multi-line edits required and workarounds fail                             |
| Cross-file moves in one apply                     | Higher risk                                            | Alternative two-step ops insufficient                                      |
| Cross-file atomic apply (50+ files)               | Per-file atomicity sufficient today                    | Real 50+ file apply + partial failure leak                                 |

Full trigger wording: [`research/codemap-richer-index-synthesis-2026-05.md` § 7](../research/codemap-richer-index-synthesis-2026-05.md#7-rejected-items-with-trigger-conditions).

---

## Cross-references

- [`substrate-extraction.md`](./substrate-extraction.md) — shipped + open AST→SQLite tiers
- [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) — full consensus / disagreement matrices (archive until all steps close)
- `src/application/apply-engine.ts` — current apply substrate
- [`docs/README.md` Rule 3](../README.md) — plan-file convention
