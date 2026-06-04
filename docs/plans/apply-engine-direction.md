# Apply-engine direction — diff-shape recipes + agent-in-the-loop substrate

> **Status:** closing — Steps 2–4, 6–12 shipped (`feat/apply-engine-slices`). Substrate Steps 5–7 live in [`substrate-extraction.md`](./substrate-extraction.md) (tiers 1–6 shipped). This plan owns the **apply-engine / diff-shape recipe** half of the richer-index synthesis.
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

_All steps below shipped on branch `feat/apply-engine-slices` (single PR). Wave-2 recipes (`organize-imports`, `missing-exports`, …) remain backlog per synthesis § 4.3._

### Step 2 — Three diff-shape recipes (S × 3) — ✓ Shipped

`replace-marker-kind`, `migrate-import-source`, `add-jsdoc-deprecated` — bundled SQL + frontmatter + golden scenarios.

### Step 3 — Per-row `actions[].command` template (S) — ✓ Shipped

`RecipeAction.command` + `renderRecipeActionCommands` / `getQueryRecipeActionsRendered`.

### Step 4 — `auto_fixable` gating (S) — ✓ Shipped

`assertApplyAutoFixable` + CLI/MCP `--force`.

### Step 6 — App-wide rename recipe (S) — ✓ Shipped

`rename-preview.sql` `call_rows` CTE; golden updated with `call_site` rows.

### Step 7 (recipe) — `rename-preview` `re_export_rows` CTE (S) — ✓ Shipped

Single-hop `re_export_rows` CTE; gated by `include_re_exports`.

### Step 8 — `apply --rows -` + `apply_rows` MCP/HTTP tool (M) — ✓ Shipped

CLI `--rows`; MCP/HTTP `apply_rows` tool.

### Step 9 — `apply --diff-input <file>` (S) — ✓ Shipped

`parseUnifiedDiffToRows` + CLI `--diff-input`.

### Step 10 — `apply --commit "<msg>"` (S) — ✓ Shipped

`gitCommitAppliedFiles` + CLI `--commit`.

### Step 11 — `--until-empty` + `--max-passes N` (S) — ✓ Shipped

`runApplyUntilEmpty` + envelope `passes` / `terminated_by` (CLI only).

### Step 12 — `apply.autoApplyRecipes` allowlist (S) — ✓ Shipped

`codemapUserConfigSchema.apply.autoApplyRecipes` + `assertApplyAllowlist`.

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
