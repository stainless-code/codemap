# Codemap richer-index — consolidated triangulation across 5 model perspectives — 2026-05

> **Status:** Open research note · consolidated 2026-05-06 by `claude-opus-4.7` from five independent strategic positions on the same prompt: "fully unlock codemap's potential and bypass the 'no fix engine' premise." The five sources have been merged into this single document; their unique substrate proposals, recipe candidates, engine extensions, argumentation chains, and reference views are inlined below with author attribution preserved.
>
> **Purpose:** Single canonical strategy doc for the codemap-richer-index direction. Captures (a) the consensus all sources reached, (b) the disagreements with per-axis verdicts and full argumentation, (c) the consolidated substrate / recipe / engine / workflow catalogs, (d) the synthesised path with open implementation questions per step, (e) the reference views (leverage-ranked, agent-angle, safety-loop, architecture diagram) that serve as design context, (f) the rejected items with trigger conditions, (g) preserved moats. Designed to stand alone without the source notes.
>
> **Lifecycle:** Open. Per [`docs-governance § Closing research`](../../.agents/skills/docs-governance/SKILL.md#closing-research). When any item lifts to a plan PR, slim the corresponding section here to a one-line "What shipped" appendix per [`docs/README.md` Rule 8](../README.md). When all items resolve, retire per the same rule.
>
> **Authoring discipline:** Per [`agents-tier-system`](../../.agents/rules/agents-tier-system.md) durability rules — no source-line citations, no specific commit hashes; symbol references and design intent only. Per [`docs-governance § 7`](../../.agents/skills/docs-governance/SKILL.md#7-cross-reference-preservation-discipline) all cross-references in this doc point at durable reference docs (`architecture.md`, `glossary.md`, `roadmap.md`) and rule numbers, not at mortal source notes (which were merged into this doc).

---

## What shipped (fact-checked 2026-05-19) — appendix per § 9 lifecycle

The substrate-growth half of this synthesis lifted to a dedicated plan PR — [`plans/substrate-extraction.md`](../plans/substrate-extraction.md) — which generalised § 4.1 / § 4.2 / § 5.3 items 1, 3 into a 13-tier sequenced plan. Per § 9's discipline ("when the synthesis path ships any step, add a 'What shipped' appendix; slim duplicated prose"), the canonical live status is **the substrate plan's per-tier headings**, not this note.

**Shipped via the substrate plan:**

- **Synthesis Step 5** (`calls.{line_start, column_start, column_end}`) — shipped as substrate plan **Tier 1 Slice 1.A**. Call metadata (`args_count`, `is_method_call`, `is_constructor_call`, `is_optional_chain`) shipped 2026-05-19.
- **Synthesis Step 7** (`exports.{line_start, line_end, column_start, column_end, is_re_export}`) — shipped as substrate plan **Tier 1 Slice 1.B**.
- **§ 4.1 column anchoring on `symbols` / `imports` / `markers`** ("Deferred (incremental)") — shipped as substrate plan **Tier 1 Slices 1.C / 1.D**.
- **§ 4.2 `import_specifiers` child table** — shipped as substrate plan **Tier 1 Slice 1.D**, including `import_id` FK and `kind='side-effect'` rows (2026-05-19).
- **§ 4.2 generalised `references` + `scopes` + `bindings` + `symbol_namespace`** ("Deferred — defer until ≥3 narrower position tables prove demand") — the trigger fired with Tier 1 landing four position-precise surfaces; lifted to substrate plan **Tier 2** and shipped in narrowed form. Live schema has `references.kind IN ('value','type','jsx','member')` and `bindings.resolution_kind IN ('same-file','imported','re-exported','global','unresolved')`; richer `bindings.namespace` remains deferred.
- **§ 5.3 leverage-ranked items 1 + 3** — shipped via Tiers 1 + 2.
- **Substrate plan Tiers 1–6 (2026-05-19)** — remainder shipped: JSX (`jsx_elements` / `jsx_attributes`), behavioral (`async_calls`, `try_catch`, `decorators`, `jsdoc_tags`), `symbols.{return_type,is_async,is_generator}`, `dynamic_imports`, `files.{is_barrel,has_side_effects}`. **`files.is_entry`** deferred to [`plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md).
- **Partial ship** of substrate plan Tiers 9 / 10 / 11 / 12 — foundation tables landed (`test_suites` / `runtime_markers` / `file_metrics` / `module_cycles`); deferred bits stay tracked under each tier's heading. Tier 4 partial: `function_params` shipped; `generic_params` / `type_predicates` deferred.

**Still open (the apply-engine half of this synthesis):**

- **§ 6 Steps 2–4, 6, 8–12** — not shipped. Step 1's doc reframe is effectively lifted into `roadmap.md` / `why-codemap.md`; the remaining 12-step path still drives the apply-engine direction (new diff-shape recipes, write-path row contracts, fixpoint loop, workflow flags, allowlist). Cross-references from the rest of this note to those steps remain live design context.
- **§ 4.4 engine extensions** (`apply --rows -`, `apply --diff-input`, `--until-empty`, etc.) — none shipped; still tracked as the agent-in-the-loop unlock per [§ 5.4 agent-angle gap analysis](#54-agent-angle-gap-analysis-from-a4).
- **§ 5.7 ambiguity signals as substrate** — still deferred per its own "until 2+ recipes hit it" trigger.

The disagreement maps (§ 3), reference views (§ 5), rejected items (§ 7), and preserved moats (§ 8) stay verbatim — they're the strategic record that justifies the 12-step path's open steps and any future trigger-firing on rejected items.

---

## Table of contents

1. [Five authorship positions (inputs summary)](#1-five-authorship-positions-inputs-summary)
2. [Consensus map](#2-consensus-map--what-all-five-positions-agree-on)
3. [Disagreement map (with full argumentation)](#3-disagreement-map--per-axis-triangulation-with-full-argumentation)
4. [Substrate catalog (consolidated)](#4-substrate-catalog-consolidated)
5. [Reference views (lifted from inputs)](#5-reference-views-lifted-from-inputs)
6. [Synthesised 12-step path with open implementation questions](#6-synthesised-12-step-path-with-open-implementation-questions)
7. [Rejected items with trigger conditions](#7-rejected-items-with-trigger-conditions)
8. [Preserved moats (universal)](#8-preserved-moats-universal)
9. [Status / lifecycle](#9-status--lifecycle)
10. [Primitive sources + internal cross-references](#10-primitive-sources--internal-cross-references)

---

## 1. Five authorship positions (inputs summary)

The triangulation drew on five distinct authorship signals across two shape classes (plan PR + research note). Two of the five (Claude Opus 4.7) contributed both a plan PR and a research note covering different angles; counted as distinct positions for triangulation purposes.

| Position label | Author                     | Original shape | Distinctive contribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1**         | Claude Opus 4.7 (plan)     | Plan PR        | 7-step roadmap; doc reframe → 3 more diff-shape recipes → `actions[].command` → `--until-empty` → `calls.{line_start, column_start}` → app-wide rename → workflow flags / agent-in-the-loop. Pre-locked decisions table; primitive-source citations table. Architecture diagram embedded.                                                                                                                                                                                                                   |
| **A2**         | Codex 5.3                  | Plan PR        | Three-layer model (Discover / Plan / Execute); curated **8–12 first-class write verbs** (`rename-symbol`, `migrate-deprecated`, `prune-unimported-export`, `normalize-import-path`, `fix-boundary-violation`); **trust tiers** (`safe` / `review` / `risky`) + per-row confidence scores; **ambiguity signals** as a substrate concern; **reliability loop** (collect conflict-rate / apply-success metrics → promote/demote commands by observed reliability).                                             |
| **A3**         | GPT-5.5                    | Plan PR        | **Action runtime** — recipes return candidate rows, not final patches; vetted handlers emit LSP `WorkspaceEdit`-style patches `{file_path, range, replacement, expected_hash}`; `references` + `bindings` + `ranges` + `export_locations` + `symbol_namespace` substrate; **6-step safety loop** (Plan → Preview → Validate → Apply → Re-index → Verify) with verifier as product surface; 3–5 first-class verbs (`rename symbol`, `fix deprecated`, `fix boundaries`, `fix unused-exports`, `move file`).  |
| **A4**         | Claude Opus 4.7 (research) | Research note  | **Strongest floor-preservation argument**; Path A vs Path B framing (cross-floor AST engine vs partner with codemod ecosystem); **`apply --diff-input <file>`** named as the highest-leverage / lowest-cost item; **11-item ranked leverage/cost table** of substrate deepenings; **agent-angle gap analysis** (already-shipped capabilities vs gaps for LLM-driven edits); **3-phase strategic phasing** (substrate depth → substrate breadth → ecosystem); 4 trigger conditions for revisiting the floor. |
| **A5**         | kimi-k2.5                  | Research note  | 6 unlock layers (Data → Transform → Recipe → Framework → Transport → Safety); **parallel `applyAstPayload()` engine** alongside the text engine (Path A); specific recipe additions with `auto_fixable: true`: `stale-imports`, `organize-imports`, `deprecated-usages`, `unused-variables`, `missing-exports`, `barrel-cleanup`; **C.9 entry-point reachability** SQL pattern.                                                                                                                             |
| **A6**         | composer                   | Research note  | Most conservative; **delegation to tsserver / oxc / codemod runners** for semantic transforms; allowlisted recipe ids for `--yes`; row caps; dry-run-first CI policy; **"rename and codemod scope (honest v1)"** framing; ops loop reasoning (apply → reindex → validate).                                                                                                                                                                                                                                  |

A1 and A4 share an author but diverge on the agent-angle weighting and AST-engine framing — counted as distinct positions throughout § 2 and § 3.

---

## 2. Consensus map — what all five positions agree on

These have **6/6** support (counting A1 and A4 separately because their conclusions diverge on emphasis even when the author overlaps). They are the load-bearing claims for the synthesised path; nothing in the disagreement map should override them.

| #   | Claim                                                                                                                                                                                                                                                                                                                                     | Supported by                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| C1  | The "no fix engine" floor language at [`roadmap.md`](../roadmap.md) Floors row 45 is **stale documentation**, contradicted by `apply-engine.ts` + `cmd-apply.ts` + `rename-preview.sql` + the [`glossary.md`](../glossary.md) "Substrate-shaped fix executor" entry. The floor conflated two product classes; doc reframe is the unblock. | A1, A2, A3, A4, A5, A6                           |
| C2  | The reframe shape: **"No verdict-shaped fix engine"** (preserved — `knip` / `eslint --fix` / `jscpd` own that class) AND **"Substrate-shaped diff executor IS in scope"** (the shipped reality; recipes propose, engine executes, agent confirms).                                                                                        | A1, A2 (implicit), A3 (implicit), A4, A5, A6     |
| C3  | `calls.{line_start, column_start}` is the **highest-ROI single substrate addition.** Closes the rename-preview substrate gap; unblocks app-wide rename of call sites; foundation for replace-deprecated-call recipes; foundation for diagnostic-push hotspot rendering when LSP plan ships.                                               | A1, A2, A3, A4, A5, A6                           |
| C4  | **Re-export source locations** are needed (whether as `exports.{line_start, column_start}` columns or a separate `export_locations` table). Re-export alias chains and barrel-safe rewrites both need it.                                                                                                                                 | A1, A2, A3, A4, A5, A6                           |
| C5  | More diff-shape recipes are needed in the bundled catalog. Today the count is 1 (`rename-preview`); consensus floor is 3–5 more. Specific candidates with multi-source agreement listed in [§ 4.3](#43-recipe-additions).                                                                                                                 | A1, A2, A3, A4 (item #4), A5, A6 (implicit)      |
| C6  | **Moat A applies to writes by analogue.** Reviewer test: _"is this fix also expressible as `query --recipe <id>` + `apply <recipe-id>`?"_ Pass → moat-clean. Fail → verdict shape; reject. The recipes are the API for writes, same as for reads.                                                                                         | A1, A2, A3, A4, A5, A6                           |
| C7  | **Dry-run-first + explicit confirmation gate is correct** and stays. Phase-1-validates-before-phase-2-writes pattern preserved; non-TTY without `--yes` rejected.                                                                                                                                                                         | A1, A2, A3, A4, A5, A6                           |
| C8  | **Watch + apply + reindex is the agent loop.** Default-ON watch on long-running transports keeps reads fresh; codemap-specific structural verification (the index reflects disk truth) is sufficient for the agent path; full typecheck/lint/tests verifier is consumer-side.                                                             | A1, A4, A6 explicit; A2, A3, A5 don't contradict |

These eight are the **non-negotiable spine** of any synthesis path. Every step in [§ 6](#6-synthesised-12-step-path-with-open-implementation-questions) preserves them.

---

## 3. Disagreement map — per-axis triangulation with full argumentation

Where the five positions diverge. Each axis carries the per-source position with the actual argumentation, the consensus weight, the synthesis verdict, and the trigger condition for revisiting deferred decisions.

### 3.1 Curated CLI write verbs vs substrate-only

**A1's argument (substrate-only):** Per-row `actions[].command` template is the agent-discovery surface. Defer verb decision until N≥3 diff-shape recipes prove the pattern. Read-side outcome-alias precedent (`dead-code` / `deprecated` / `boundaries` / `hotspots` / `coverage-gaps` capped at 5 per `codemap.mdc`) requires recipes to land first; pre-empting that for writes inverts the precedent.

**A2's argument (8–12 verbs):** Default UX should be vetted commands; expert override is the raw recipe / apply path. Catalog target after stabilisation: 8–12 vetted write commands. Initial set: `rename-symbol`, `migrate-deprecated`, `prune-unimported-export`, `normalize-import-path`, `fix-boundary-violation`. Trust tiers + confidence scores are how this stays moat-clean — verbs are wrappers, not new engines.

**A3's argument (3–5 verbs):** Cap first-class write verbs around 3–5 (`codemap rename symbol <old> <new>`, `codemap fix deprecated`, `codemap fix boundaries`, `codemap fix unused-exports`, `codemap move file <old> <new>`). Let recipes and actions scale; keep commands rare. Verbs are user-facing primitives; recipes are the implementation substrate.

**A4 / A5 / A6's positions:** No new verbs proposed; recipes are the surface (A4, A5). A6 advocates allowlist / config-gated `--yes` instead of new verbs.

**Weight:** 4 against verbs (A1, A4, A5, A6) vs 2 for verbs (A2, A3). The 2 pro-verb sources disagree internally on cap (8–12 vs 3–5).

**Verdict:** **Substrate-only path with self-describing rows (A1's `actions[].command` template).** Rationale:

- Stronger consensus.
- Aligns with [Moat A](../roadmap.md#moats-load-bearing) reviewer test more cleanly — every verb has to also be a recipe, so verb-as-thin-wrapper is moat-clean only if the recipe layer exists first.
- Matches [`codemap.mdc`](../../.cursor/rules/codemap.mdc) outcome-alias cap (5 for read aliases). Adding write verbs before the substrate proves out reverses the read precedent.
- The two pro-verb positions (A2, A3) disagree on cap and target set; that disagreement is itself evidence the verb decision is premature — the recipe data hasn't generated the consensus that would lock a cap.

**Trigger to revisit:** ≥3 diff-shape recipes shipping AND clear agent-host UX demand for verb-level discovery beyond `actions[].command` template. At that point, plan PR settles cap (3–5 vs 8–12) + initial verb set.

### 3.2 Path A (cross floor — AST engine) vs Path B (stay substrate; partner with codemod ecosystem)

**A4's argument (Path B explicit):** Path A makes codemap "yet another refactor tool" — there are several established ones (`ts-morph`, `jscodeshift`, `comby`) with deep edge-case coverage; the value-add of "but with SQL queries on top" doesn't justify owning a printer for source maps, comment preservation, formatting fidelity, and the 100 other things refactor engines have to get right. Path A cons:

- Compete with `ts-morph` / `jscodeshift` on their home turf — they have years of edge-case handling.
- AST-printer maintenance burden non-trivial in perpetuity.
- Codemap positioning blurs ("what is this thing?").
- The floor was protecting against verdict creep — once codemap has an AST writer, every "codemap should also format / lint / autofix" feature request becomes plausible. Floor disappearance makes product surface unbounded.

**A4's Path B sketch (~30 lines of user-side glue):**

> _Unvalidated illustration._ The `@stainless-code/codemap-mcp` package and `codemap.query_recipe` shape are aspirational — actual exports may differ when this Path lands. `ts-morph` is real.

```ts
import { codemap } from "@stainless-code/codemap-mcp";
import { Project } from "ts-morph";

const targets = await codemap.query_recipe("find-deprecated-with-callers", { … });
const project = new Project();
for (const t of targets) {
  project
    .addSourceFileAtPath(t.file_path)
    .getFunction(t.name)
    ?.rename(t.suggested_new_name);
}
project.save();
```

Floor preserved; codemap's positioning stays clean; ecosystem leverage — every `ts-morph` / `jscodeshift` user can adopt codemap as their discovery layer with no rip-and-replace.

**A5's argument (Path A — parallel AST engine):** Add a new row contract for AST-aware transforms coexisting with the text-based engine:

```ts
interface AstTransformRow {
  file_path: string;
  transform_kind:
    | "rename-symbol"
    | "delete-import"
    | "wrap-function"
    | "extract-constant";
  target_span: { start: number; end: number };
  payload: unknown;
}
```

Engine integration: `applyAstPayload()` parallel to `applyDiffPayload()`. Recipes opt in via frontmatter `transform_mode: 'text' | 'ast'` (default `text` for backwards compat). Leverage existing `oxc-parser`; re-emit source via `oxc-codegen` or recast-style printer. Unlocks safe multi-line transforms, comment preservation, and semantic awareness (renaming only the callee `foo()` not the property `obj.foo`).

**A3's argument (Path A long-term):** Action runtime emits `WorkspaceEdit`-shaped patches via vetted transformer; near-term still text-based. Long-term contract: recipes return `{action_type, symbol_id, params_json}`, not final string replacements. Each action returns a `WorkspaceEdit`-like patch set: `{file_path, range, replacement, expected_hash}`.

**A1 / A6's positions:** Path B implicit (multi-line + kind-tagged row contract still substring-based; agent-in-the-loop validates LLM-proposed text). A6 advocates explicit delegation to tsserver / oxc / codemod runners for semantic transforms.

**Weight:** 3 explicit Path B (A1, A4, A6) + 1 leaning toward delegation = 4. Path A: 2 (A5, A3 long-term). 1 neutral (A2).

**Verdict:** **Path B.** A4's argument is the most rigorous in the set. The Path B alternative — agent-in-the-loop via stdin diff input + `codemap-to-tsmorph` adapter — preserves codemap's positioning AND covers the AST-shape transformations Path A would target.

**Trigger to revisit (per A4 § Trigger conditions):** ≥2 of:

1. ≥3 external project teams hit the substring-substitution wall on real recipes.
2. A specific AST-shape transformation class (e.g. JSX prop migration) is requested with concrete consumer demand.
3. The agent ecosystem moves toward AST-template-shaped patches as a common output format AND the substring contract becomes the bottleneck.
4. Path B (codemod-tool adapter) ships, gets adoption, and friction in the handoff seam motivates an integrated AST writer.

Until ≥2 fire, Path A stays out.

### 3.3 `apply --diff-input` / `apply --rows -` (arbitrary diff source)

**A4's argument (highest-leverage / lowest-cost):** Accept any source-of-truth diff — LLM-generated, hand-crafted, codemod-emitted — and run it through codemap's existing path-containment + duplicate-edit + line-drift conflict pipeline. Codemap doesn't synthesise the edits, just executes pre-described ones safely. Strategically the highest-leverage / lowest-cost item:

- Turns codemap into a **safe-write substrate** for arbitrary fix sources, not just recipes.
- Bridges the LLM-edit / human-edit / codemod-edit worlds through one conflict-checked applier.
- Floor-preserving — the agent / codemod / human supplies the diff; codemap just gates writes through the same machinery `apply <recipe>` uses.

**A1 + A3's positions:** A1 has `--rows -` (CLI stdin) + `apply_rows` (MCP) as Step 7–8 of its plan. A3 has equivalent via `WorkspaceEdit`-shaped patches.

**A2 / A5 / A6:** Don't address.

**Weight:** 3 explicit (A1, A3, A4) of which A4 calls it the single biggest leverage move; 3 silent.

**Verdict:** **Promote to first-tier priority.** A1's plan had it as Step 7-8 (workflow flags); A4's framing as the highest-leverage substrate move is decisive — the agent-host market is the most-under-tapped dimension. The synthesis path puts it earlier in the sequence (post-substrate, pre-AST-engine-temptation).

**Shape decision (synthesis):**

- CLI: `codemap apply --rows -` (stdin reads JSON array of `{file_path, line_start, before_pattern, after_pattern}` rows; same envelope as recipe-driven path).
- CLI: `codemap apply --diff-input <file>` (reads unified diff; converts to row contract internally; same conflict pipeline).
- MCP / HTTP: `apply_rows` tool (rows array as input).

Two input shapes converge on the same engine; both pass through phase-1 validation (substring match, line drift, path containment, duplicate-edit checks).

### 3.4 Trust tiers + confidence scores + verifier

**A2's argument (trust tiers + confidence):** Three tiers (`safe` / `review` / `risky`) on recipes/actions; confidence score in `diff-json` rows to gate low-certainty edits. Default UX: vetted command/action path with policy gating; expert override: raw recipe/apply. Mandatory `--dry-run` preview path for new commands until confidence criteria met; block writes on unresolved ambiguity classes.

**A2's reliability loop:** Collect conflict-rate / apply-success metrics; promote/demote commands by observed reliability. Operational data drives the catalog evolution, not speculation.

**A3's argument (verifier as product surface):** Every write workflow follows the same loop:

1. **Plan:** candidate query selects rows; action handler expands them into edit intent.
2. **Preview:** show unified diff and structured conflicts.
3. **Validate:** confirm hashes/ranges still match disk.
4. **Apply:** write temp + rename per file; abort before writes on validation conflicts.
5. **Re-index:** targeted index of touched files.
6. **Verify:** run declared checks (`typecheck`, lint, tests) and compare expected structural delta.

The verifier is part of the product surface, not a best-effort caller habit. Action metadata declares which checks run; CLI / MCP / HTTP return one verification envelope.

**A6's argument (allowlist + operational discipline):** Allowlisted recipe ids for `--yes`; row caps; dry-run-first in CI. Light operational discipline, not full trust tiers.

**A1 / A4 / A5's positions:** A1 has only `auto_fixable: false/true` (existing flag, currently advisory); agent-side review is the gate. A4 has no trust tiers; A5 defaults `auto_fixable: false` per recipe with opt-in.

**Weight:** Three propose some form of trust gating (A2, A3, A6). Three don't (A1, A4, A5). Within the pro-trust group, the proposals diverge: trust-tier metadata vs verifier-as-product vs allowlist config.

**Verdict (compromise):** **Light trust gating; reject heavy verifier.** Two minimal moves:

1. **Make `auto_fixable` actually gate writes** (today it's advisory in `actions[]`). Apply requires `auto_fixable: true` OR explicit `--force` flag. Recipe authors opt in per fix.
2. **Config-driven allowlist for `--yes`** (A6) — `.codemap/config.{ts,js,json}` carries `apply.autoApplyRecipes: string[]`; recipes outside the list require interactive confirm even with `--yes`. Optional, opt-in.

Reject:

- **Trust tiers** (A2's `safe`/`review`/`risky`) — adds taxonomy debt; the binary `auto_fixable` flag plus the allowlist covers the same use cases without a third concept.
- **Confidence scores** (A2) — speculative; no consensus on how scores are computed; defer until 2+ recipes need it.
- **Verifier as product surface** (A3's typecheck/lint/tests) — scope creep into orchestration. Watch + reindex covers the codemap-side structural verification; full verifier belongs to the consumer's CI / pre-commit.

**Trigger to revisit per item:**

- Trust tiers: allowlist proves insufficient AND ≥2 consumers ship `jq`-style trust filters in CI.
- Confidence scores: a recipe ships where `before_pattern` matches multiple sites and the desired UX is per-site ranking.
- Verifier as product: a consumer-driven plan PR articulates the verifier shape with concrete examples.

**Reliability loop:** A2's reliability-loop concept (collect conflict-rate / apply-success metrics for promote/demote) is **deferred to operational telemetry** — codemap doesn't ship telemetry upload (per Floors row), so reliability data has to live on a self-hosted observability surface or in `.codemap/index.db` as opt-out per-project metrics. Plan PR addresses shape if a consumer requests it.

### 3.5 Generalised `references` table (now) vs incremental position tables

**A3's argument (full binding-grade now):** Whole-app fixes need location-precise facts:

- `references` — every identifier/property/import/export occurrence with file, range, text, role, and namespace.
- `bindings` — resolved identity for each reference (`symbol_id` or equivalent), including shadowing and import/export indirection.
- `ranges` — reusable source spans for definitions, imports, exports, object members, and call sites.
- `export_locations` — concrete source ranges for direct exports, re-exports, aliases, and barrel chains.
- `symbol_namespace` — value/type/member/default namespace so actions avoid TS false matches.

Without this substrate, `rename-preview` can stay conservative but cannot become full-app rename.

**A4's argument (single `references` + `scopes` table):**

```text
references
  file_path, line_start, column_start, column_end,
  name, scope_id, resolved_symbol_path, kind
  (kind: 'value' | 'type' | 'jsx' | 'decorator' | 'shorthand' | ...)

scopes
  scope_id, file_path, kind ('module'|'function'|'block'),
  parent_scope_id, line_start, line_end
```

Unlocks (recipe-shaped, no fix engine needed):

- Full app-wide rename — recipes JOIN `references` instead of guessing.
- Genuine dead-code detection — "exported symbol with zero `references` rows in any other file."
- Scope-aware queries — "find shadowed names" / "rename only in this scope."
- Cross-file flow questions answered in one query.

Cost: parser walk depth, index size (potentially 10× for medium projects), reindex time. Reward: ~70% of "I wanted codemap to do refactor X" conversations terminate here.

**A1 / A2 / A5 / A6's positions:** A1 defers — add narrow tables (`calls.{line_start, column_start}` first; `exports.{line_start, column_start}` next; `import_specifiers` / `jsx_usages` per demand); consolidate later if pattern emerges. A2: "reference-kind tagging" without committing to single table. A5: calls extension first; doesn't commit to references table. A6: "reference-grade locations" without committing to shape.

**Weight:** 2 propose full table now (A3, A4); 4 are incremental or non-committal. Even A4 ranks the references table XL effort and not first in its phasing.

**Verdict:** **Incremental; defer generalised `references` table.** Rationale:

- 4 of 6 lean incremental.
- Even A4 (which proposes the full shape) ranks it XL effort and not first in sequencing.
- Matches [`roadmap.md` § Backlog](../roadmap.md#backlog) precedent — `audit verdict` deferred until 2 consumers ship `jq` thresholds; AST body hashes deferred until plan PR resolves design questions. Same discipline applies.
- Per [`codemap.mdc`](../../.cursor/rules/codemap.mdc) Moat B reviewer test ("what recipe does this kill?"): no shipping recipe today is killed by deferring the table; new recipes can land with narrow tables and re-target a unified table when it arrives.

**Trigger to revisit:** When the third position-table lands AND a recipe wants to UNION across all three. Then evaluate consolidation.

### 3.6 Tracer-bullet sequencing

All five positions propose sequencing; the orderings differ on what ships first. Consensus first move: **the doc reframe** (universal). Consensus second move: **`calls.{line_start, column_start}`** (universal). After that the orderings diverge:

| Source | After substrate first                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| A1     | More diff-shape recipes → `actions[].command` → `--until-empty` → app-wide rename → workflow flags → agent-in-the-loop |
| A2     | Trust policy → curated rename command → migration command → reliability loop                                           |
| A3     | Reference table → binding resolution → barrel chains → action registry → verifier                                      |
| A4     | Column anchoring + `apply --diff-input` + recipes → references + scopes → ecosystem (codemod adapter + LSP)            |
| A5     | Expanded rename-preview → stale-imports recipe → C.9 entry-point schema → AST transform contract                       |
| A6     | Reference locations OR delegation strategy → config for which recipes accept `--yes`                                   |

**Verdict:** Synthesis sequence in [§ 6](#6-synthesised-12-step-path-with-open-implementation-questions) below combines:

- All 8 consensus points (§ 2) ship first.
- The agent-in-the-loop unlock (§ 3.3) gets earlier priority than A1 had it.
- AST-engine work (§ 3.2 Path A) is the explicit deferred item; not in the synthesis sequence at all.

---

## 4. Substrate catalog (consolidated)

Every substrate addition proposed across all five positions, with author attribution + verdict (in synthesis path / deferred / rejected). Use this as the master list for plan PRs.

### 4.1 Substrate columns on existing tables

| Column add                                                              | Sources                                                                       | Effort | Verdict                                                                                                                                                                                              | Plan-PR notes                                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calls.{line_start, column_start}`                                      | A1, A2 (call-site spans), A3, A4 (column anchoring), A5 (with column_end), A6 | S      | **Synthesis Step 5** · **✓ Shipped 2026-05-15** ([`substrate-extraction.md` Tier 1 Slice 1.A](../plans/substrate-extraction.md#tier-1--position-precision-on-existing-tables--shipped-2026-05-14))   | Reuse existing `buildLineMap` / `offsetToLine` from `parser.ts`; one-shot reindex on schema bump                                                                         |
| `calls.column_end` (vs only column_start)                               | A5 explicit                                                                   | XS     | **Plan PR question** · **✓ Shipped 2026-05-15** (Tier 1 Slice 1.A — `column_end` landed alongside `column_start`)                                                                                    | Symmetric to start; cheap; needed for column-precise span replace per A4                                                                                                 |
| `exports.{line_start, column_start}` (or `export_locations` table)      | A1, A2 (re-export traceability), A3 (`export_locations`), A4, A5, A6          | S      | **Synthesis Step 7** · **✓ Shipped 2026-05-15** (Tier 1 Slice 1.B — chose the columns-on-existing-table shape)                                                                                       | Closes the second rename-preview substrate gap                                                                                                                           |
| Column anchoring on `symbols` / `imports` / `markers` (existing tables) | A4 explicit                                                                   | M      | **Deferred (incremental)** · **✓ Shipped 2026-05-15** (Tier 1 Slices 1.C — `symbols.name_column_*` + `markers.column_*` — and 1.D — `import_specifiers` child table replaces per-import column adds) | Eliminates same-line ambiguity caveat (`const foo = foo();` first-occurrence trap); recipes opt in by emitting columns, fall back to substring match when columns absent |
| `symbols.body_hash` (already on roadmap)                                | A4 mentions                                                                   | M      | **Already in roadmap backlog**                                                                                                                                                                       | Tracked: AST-hash duplication                                                                                                                                            |

### 4.2 New substrate tables

| Table                                                                | Sources                         | Effort | Verdict                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import_specifiers(file_path, line, col_start, col_end, name, kind)` | A1, A3 (subset of `references`) | M      | **Deferred** · **✓ Shipped 2026-05-15** ([Tier 1 Slice 1.D](../plans/substrate-extraction.md#tier-1--position-precision-on-existing-tables--shipped-2026-05-14)) — split `imports.specifiers` JSON blob into typed child rows; unlocks specifier-precise edits, type-only specifier rewrite, dedupe-imports                                     |
| `jsx_usages(file_path, component_name, line_start, col_start)`       | A1, A3 (subset of `references`) | M      | **Deferred** — component renames + prop migration; React-specific app-wide rename. **Note:** Tier 2 ships `references.kind='jsx'` covering JSX identifier sites; the richer per-element / per-attribute substrate (`jsx_elements` / `jsx_attributes`) is tracked at [`substrate-extraction.md` Tier 3](../plans/substrate-extraction.md) (open) |
| `references` (generalised) + `scopes`                                | A3, A4                          | XL     | **Deferred** · **✓ Shipped 2026-05-15** ([Tier 2 closed](../plans/substrate-extraction.md)) — the trigger fired with Tiers 1.A–D landing four position-precise surfaces; UNION-style rename recipes are now expressible against the generalised tables                                                                                          |
| `bindings` (resolved identity per reference)                         | A3 explicit                     | XL     | **Deferred** · **✓ Shipped 2026-05-15** (Tier 2.1) — same-file scope walk → imports → re-export chains → globals; reaches 1.3% unresolved on codemap-self                                                                                                                                                                                       |
| `ranges` (reusable source spans)                                     | A3 explicit                     | M      | **Deferred** — subsumed under generalised `references` plan; not needed today (`(file_path, line_start, column_start, column_end)` tuples on each substrate table substitute)                                                                                                                                                                   |
| `symbol_namespace` (value/type/member/default)                       | A3 explicit                     | M      | **Deferred** · **✓ Shipped (partial) 2026-05-15** — landed as `references.kind` enum (`value` / `type` / `jsx` / `member`) + `bindings.resolution_kind`; the `default` namespace folds into `imports.specifiers.kind = 'default'`                                                                                                               |
| `files.is_entry` (entry-point annotation)                            | A5 (C.9 plan integration)       | S      | **Tracked in [`plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md)** — orthogonal to this synthesis path; recipes JOIN once C.9 ships                                                                                                                                                                                                       |
| `history` (per-commit symbol snapshots)                              | A4 mentions item #5             | L      | **Already in roadmap backlog** — temporal substrate; defer per existing revisit triggers                                                                                                                                                                                                                                                        |

### 4.3 Recipe additions

Every recipe candidate proposed across all five positions. **Diff-shape** = emits `{file_path, line_start, before_pattern, after_pattern}` rows for `apply`. **Advisory** = read-only review surface.

| Recipe id                                                          | Sources                                    | Shape                                 | Substrate needed                                                         | Verdict                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `replace-marker-kind` (params: `from`, `to`)                       | A1                                         | Diff-shape                            | `markers.line_number` + `content` (existing)                             | **Synthesis Step 2**                                                                          |
| `migrate-import-source` (params: `old`, `new`)                     | A1, A2 (`normalize-import-path`)           | Diff-shape                            | `imports.line_number` + `source` (existing)                              | **Synthesis Step 2**                                                                          |
| `add-jsdoc-deprecated` (params: `name`, `replacement`)             | A1                                         | Diff-shape                            | `symbols.line_start` + `doc_comment` (existing; insert above)            | **Synthesis Step 2**                                                                          |
| `migrate-deprecated` (params: replacement-map)                     | A2, A3, A5 (`deprecated-usages`)           | Diff-shape                            | `symbols.doc_comment` + (post-Step 5) `calls.{line_start, column_start}` | **Backlog** — ships post-Step 5                                                               |
| `prune-unimported-export`                                          | A2                                         | Diff-shape (review-first)             | `exports` + `imports` (existing)                                         | **Backlog** — ships after first 3 diff-shape recipes prove the substrate                      |
| `fix-boundary-violation`                                           | A2, A3                                     | Diff-shape (guided)                   | `boundary_rules` + `dependencies` (existing)                             | **Backlog** — ships post-Step 5                                                               |
| `stale-imports` (delete unused specifiers)                         | A5 (with `auto_fixable: true`)             | Diff-shape                            | `imports.specifiers` JSON; needs care vs dynamic usage                   | **Backlog** — ships after `import_specifiers` child table OR with conservative JSON-blob walk |
| `organize-imports` (sort + group by proximity)                     | A5 (with `auto_fixable: true`)             | Diff-shape                            | `imports.line_number` + `source` (existing); deterministic sort          | **Backlog** — single-file recipe; viable today                                                |
| `unused-variables`                                                 | A5                                         | Advisory (review-first)               | scope graph (deferred)                                                   | **Deferred** — needs scope substrate; might be side-effect-only                               |
| `missing-exports` (internal symbols imported cross-module)         | A5                                         | Advisory                              | `imports` + `exports` (existing)                                         | **Backlog** — viable today; review-first                                                      |
| `barrel-cleanup` (re-exports with no consumers)                    | A5                                         | Advisory (review-first)               | `exports.re_export_source` + `imports` (existing)                        | **Backlog** — viable today                                                                    |
| `deprecated-usages` (`@deprecated` JSDoc → `@replacement` rewrite) | A5 (with conditional `auto_fixable: true`) | Diff-shape                            | `symbols.doc_comment` + (post-Step 5) `calls.{line_start, column_start}` | **Backlog** — ships post-Step 5; subset of `migrate-deprecated`                               |
| App-wide rename recipe extension                                   | A1, A5                                     | Diff-shape (extends `rename-preview`) | (post-Step 5) `calls.{line_start, column_start}`                         | **Synthesis Step 6**                                                                          |
| Re-export rename extension                                         | A1                                         | Diff-shape (extends `rename-preview`) | (post-Step 7) `exports.{line_start, column_start}`                       | **Synthesis Step 7**                                                                          |
| `dead-files-by-reachability`                                       | A5 (depends on C.9 plugin)                 | Advisory                              | (post-C.9) `files.is_entry`                                              | **Tracked in [`plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md)**                      |
| `extract-function` (experimental)                                  | A5 (Path A AST contract)                   | AST transform                         | parallel `applyAstPayload()` engine                                      | **Rejected** — Path A out of scope per § 3.2                                                  |

### 4.4 Engine extensions

| Extension                                                                                                      | Sources                                           | Effort | Verdict                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `apply --rows -` (CLI stdin) + `apply_rows` MCP/HTTP tool                                                      | A1, A3 (via WorkspaceEdit), A4 (highest-leverage) | M      | **Synthesis Step 8**                                                                            |
| `apply --diff-input <file>` (unified diff source)                                                              | A4                                                | S      | **Synthesis Step 9**                                                                            |
| `--until-empty` apply-loop with `--max-passes N`                                                               | A1                                                | S      | **Synthesis Step 11**                                                                           |
| Multi-line + kind-tagged row contract (`before_lines`, `kind: replace/insert-before/insert-after/delete-line`) | A1                                                | M × 2  | **Backlog** — ships after Step 11                                                               |
| Cross-file moves (`move_to: { file_path, line_start }`)                                                        | A1 mentions                                       | L      | **Deferred** — higher risk, less immediate value                                                |
| Cross-file atomic apply (pre-write backups + restore-on-throw)                                                 | A1 mentions                                       | M      | **Deferred** — current per-file atomicity (temp + rename) is fine for ≤10 files; revisit at 50+ |
| Parallel `applyAstPayload()` AST engine                                                                        | A5, A3 long-term                                  | XL     | **Rejected (Path A)** — per § 3.2; Path B alternative ships instead                             |

### 4.5 Workflow extensions

| Extension                                                                 | Sources                                                        | Effort | Verdict                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `apply --commit "<msg>"`                                                  | A1                                                             | S      | **Synthesis Step 10**                                                                      |
| `apply --branch <name>`                                                   | A1                                                             | S      | **Backlog**                                                                                |
| `apply --output-patch <file>` (unified diff without write)                | A1                                                             | S      | **Backlog**                                                                                |
| `apply.autoApplyRecipes` allowlist config                                 | A6, A1 (Step 12)                                               | S      | **Synthesis Step 12**                                                                      |
| `auto_fixable` gating (flip from advisory to enforcing)                   | A2 (trust tiers extension), A5 (default false), A6 (allowlist) | S      | **Synthesis Step 4**                                                                       |
| Trust tiers (`safe` / `review` / `risky`)                                 | A2                                                             | M      | **Rejected** — covered by `auto_fixable` + allowlist                                       |
| Per-row confidence scores                                                 | A2                                                             | M      | **Deferred** — speculative; no consensus on computation                                    |
| Verifier as product surface (typecheck / lint / tests + structural delta) | A3                                                             | L      | **Deferred** — scope creep; consumer-side CI owns this                                     |
| Reliability loop (collect conflict-rate / apply-success metrics)          | A2                                                             | L      | **Deferred** — needs telemetry surface; codemap doesn't ship telemetry upload (Floors row) |
| Per-row `actions[].command` template (self-describing fixes)              | A1                                                             | S      | **Synthesis Step 3**                                                                       |
| Curated CLI write verbs (3–5 per A3, 8–12 per A2)                         | A2, A3                                                         | M      | **Deferred** — per § 3.1 verdict                                                           |
| `codemap-to-tsmorph` adapter (Path B partner)                             | A4                                                             | M      | **Backlog** — separate package experiment after Step 8 ships                               |

---

## 5. Reference views (lifted from inputs)

Strategic views from the source notes that serve as design context for the synthesised path. Lifted here so the design rationale is preserved without referring to mortal source files.

### 5.1 Architecture diagram (from A1)

The substrate-level data flow that the synthesis path grows. Recipes propose; engines pass through; index is the substrate. Every step in [§ 6](#6-synthesised-12-step-path-with-open-implementation-questions) either enriches the index (new columns / tables / recipe categories) or enriches what the engines can consume from it (richer row contract, fixpoint loop, workflow integration). Nothing in the synthesis path adds a new engine — existing ones grow capacity through the data they read.

```text
                                       ┌─────────────────────────────────┐
                                       │  agent / human author writes    │
                                       │  one .sql + one .md frontmatter │
                                       └────────────────┬────────────────┘
                                                        │
                                                        ▼
              ┌─────────────────────────────────────────────────────────────────────┐
              │  recipes-loader.ts                                                  │
              │    ↳ frontmatter params + actions[] (incl. NEW: actions[].command)  │
              └────────────────┬────────────────────────────────────────────────────┘
                               │
                               ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │  query-engine.ts (read path)            apply-engine.ts (write path)             │
   │    ↳ executeQuery                         ↳ applyDiffPayload                     │
   │    ↳ JSON / SARIF / annotations /         ↳ phase-1 validate, phase-2 write      │
   │      mermaid / diff / diff-json           ↳ NEW: --until-empty fixpoint loop     │
   │                                           ↳ NEW: --commit / --branch / --rows -  │
   └────────────────┬──────────────────────────────────────────┬──────────────────────┘
                    │                                          │
                    ▼                                          ▼
   ┌──────────────────────────────────────┐       ┌──────────────────────────────────┐
   │  the index (this plan's surface)     │       │  on-disk source (writes)         │
   │    symbols, imports, exports,        │◀──────│  read by phase-1; written by     │
   │    calls (NEW: line_start, col_*),   │       │  phase-2 (sibling-temp + rename) │
   │    markers, type_members, …          │       └──────────────────────────────────┘
   │    (richer over time per § 4)        │
   └──────────────────────────────────────┘
```

### 5.2 Six-step safety loop (from A3)

A3's framing of how every write workflow flows. The synthesis path embraces steps 1–5 (already shipped or covered by Steps 1–12); step 6 (verifier as product surface) is **deferred** per § 3.4 verdict — codemap-side structural verification (watch + reindex) covers the substrate; full typecheck / lint / tests verification belongs to the consumer's CI / pre-commit.

| Step            | Action                                                                                | Status in synthesis                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **1. Plan**     | Candidate query selects rows; action handler expands them into edit intent.           | ✓ Shipped — recipe SQL + per-row `actions[]`                                                                                     |
| **2. Preview**  | Show unified diff and structured conflicts.                                           | ✓ Shipped — `--format diff` / `diff-json`                                                                                        |
| **3. Validate** | Confirm hashes/ranges still match disk.                                               | ✓ Shipped — phase-1 conflict checks (line drift, file missing, line out of range, path containment, duplicate edit on same line) |
| **4. Apply**    | Write temp + rename per file; abort before writes on validation conflicts.            | ✓ Shipped — phase-2 (POSIX-atomic per file via sibling-temp + rename)                                                            |
| **5. Re-index** | Targeted index of touched files.                                                      | ✓ Shipped — `runCodemapIndex({mode: 'files', files: [...changed]})` via watcher or explicit reindex                              |
| **6. Verify**   | Run declared checks (`typecheck`, lint, tests) and compare expected structural delta. | **Deferred** — consumer-side CI owns this; revisit if a concrete consumer plan PR emerges                                        |

### 5.3 Eleven-item leverage-ranked table (from A4)

A4's full ranking of substrate / engine deepenings by leverage and floor-impact. Items 1–10 are floor-preserving; only item 11 crosses the floor. The synthesis path covers items 1, 2, 3 (deferred), 4, 9; item 5 is already in roadmap backlog; item 8 is tracked in the LSP plan; item 11 is **rejected (Path A)**.

| #   | Item                                                          | Cost | Leverage  | Crosses floor? | Status in synthesis                                                                                                                                                                              |
| --- | ------------------------------------------------------------- | ---- | --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Column anchoring on `symbols` / `exports` / `imports` etc.    | M    | High      | No             | **Synthesis Step 5, 7** · **✓ Shipped 2026-05-15** ([Tier 1 Slices 1.A–1.D](../plans/substrate-extraction.md#tier-1--position-precision-on-existing-tables--shipped-2026-05-14)) — full coverage |
| 2   | `apply --diff-input <file>` (arbitrary diff source)           | S    | High      | No             | **Synthesis Step 8, 9** — open                                                                                                                                                                   |
| 3   | `references` table + scope graph                              | XL   | Very high | No             | **Deferred** · **✓ Shipped 2026-05-15** ([Tier 2 closed](../plans/substrate-extraction.md)) — references + scopes + bindings; 1.3% unresolved                                                    |
| 4   | `RECIPE-AUTHORING.md` skill + 4 new pre-vetted recipes        | M    | High      | No             | **Synthesis Step 2** (3 recipes; skill optional)                                                                                                                                                 |
| 5   | AST body hashes (`symbols.body_hash`)                         | M    | Medium    | No             | **Already in roadmap backlog**                                                                                                                                                                   |
| 6   | History table + temporal recipes                              | L    | Medium    | No             | **Already in roadmap backlog**                                                                                                                                                                   |
| 7   | Cross-language join exemplars + docs                          | S    | Medium    | No             | **Deferred** — docs improvement; not a substrate move                                                                                                                                            |
| 8   | LSP diagnostic-push server                                    | XL   | High      | No             | **Tracked in [`plans/lsp-diagnostic-push.md`](../plans/lsp-diagnostic-push.md)**                                                                                                                 |
| 9   | `codemap-to-tsmorph` adapter + recipe-discovery shim (Path B) | M    | High      | No             | **Backlog** — separate package experiment after Step 8                                                                                                                                           |
| 10  | Real-time feedback for LLM agents (watch + apply integration) | S    | Medium    | No             | **Already shipped** (default-ON watch on `mcp` / `serve`)                                                                                                                                        |
| 11  | AST-template row shape (Path A)                               | XL   | Variable  | **Yes**        | **Rejected** — per § 3.2                                                                                                                                                                         |

Items 1–10 are all pre-floor; the floor is doing zero blocking until item 11.

### 5.4 Agent-angle gap analysis (from A4)

A4's audit of where codemap stands on supporting LLM-driven edits. The under-tapped market is **substrate FOR LLM-driven edits**, not codemap-as-codemod-tool.

| Capability                                | Already there?                 | Gap                                                                                                                                             |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent queries codemap                     | ✓ MCP `query` / `query_recipe` | None                                                                                                                                            |
| Agent gets blast-radius before editing    | ✓ `impact`                     | None                                                                                                                                            |
| Agent dry-runs an edit                    | ✓ `apply --dry-run`            | None                                                                                                                                            |
| Agent emits arbitrary diff (not a recipe) | ✗                              | `apply --diff-input` / `apply --rows -` — turns codemap into the safe-write substrate for any fix source (**Synthesis Steps 8, 9**)             |
| Agent gets feedback after edit            | ✓ partial via `watch`          | Real-time reindex covers it; LSP-style diagnostics still missing (tracked in [`plans/lsp-diagnostic-push.md`](../plans/lsp-diagnostic-push.md)) |
| Agent reasons about API safety            | ✗                              | "This rename touches the public API surface" needs a notion of external consumers — beyond v1 substrate                                         |

Concretely, the codemap-enabled agent flow:

1. User asks an agent to do X.
2. Agent queries codemap via MCP for structural facts (`query_recipe` / `impact` / `show`).
3. Agent emits `apply`-shaped rows OR a unified diff that codemap-apply executes safely.
4. Apply runs `--dry-run` first, then `--yes` after the agent (or human) reviews.

### 5.5 Three-phase strategic phasing (from A4)

A4's recommended phasing once the doc reframe lands:

- **Phase 1 (substrate depth):** Ship column anchoring + `apply --diff-input` + 3–4 new diff-shape recipes. These three together turn `apply` from a narrow `rename-preview` runner into a general structural-edit substrate — recipes for surgical mass edits, arbitrary diffs for one-off LLM patches, columns for precision.
- **Phase 2 (substrate breadth):** Ship references + scopes (or, per synthesis verdict, the incremental position tables). Single largest leverage for full app-wide refactor expressiveness AND lets the agent ecosystem reason about scope.
- **Phase 3 (ecosystem):** Ship `codemap-to-tsmorph` adapter (Path B) + LSP diagnostic-push server. Codemap stops being a CLI; becomes the substrate other tools build on.

**Re-evaluation gate before Phase 4:** if real users repeatedly hit cases that need item 11 (AST-template row shape) AND the substrate-only path can't reach them, revisit the floor with concrete demand. By that point the substrate is so broad that the "should we be a fix engine?" question answers itself based on actual gaps, not speculation.

### 5.6 "Honest v1" rename framing (from A6)

A6's framing of `rename-preview`'s scope as a deliberate v1 conservatism, not a design failure. Bundled `rename-preview` intentionally covers:

- Symbol **definitions** in `symbols`.
- **Direct named import specifiers** when `imports.resolved_path` matches the defining file.

It does **not** fully cover: call sites inside bodies, re-export chains, string literals, dynamic access, or ambiguous same-line identifiers. **Full-application rename** requires either **substrate growth** (reference locations in the index — addressed by Synthesis Steps 5 / 6 / 7) or **delegation** to a TS/oxc refactor path (addressed by the `codemap-to-tsmorph` adapter backlog item). SQL unify "find all usages" is not yet equivalent to IDE rename.

Rigidity is appropriate next to `apply`: substring replace on a line is dangerous without precise spans. Widening should follow **index improvements** and **recipe tests**, not ad-hoc SQL generosity. The synthesis path enforces this — every recipe extension waits for its substrate column.

### 5.7 Ambiguity signals as substrate (from A2)

A2's framing — under-emphasised in the synthesis path. Persist enough metadata to flag multi-hit / unsafe replacements **up front**, in the diff-json envelope, before phase-1 validation. Reduces phase-2 surprises and partial-coverage renames.

Concrete shapes (plan PR addresses):

- `ambiguity_count: int` on diff-json rows where `before_pattern` would match multiple sites on the same line.
- `ambiguity_kind: 'same-line-multi' | 'cross-scope' | 'shadowed-name' | 'dynamic-dispatch'` for human-readable triage.
- Recipes that emit ambiguous rows opt into `auto_fixable: false` automatically.

Defer until 2+ recipes hit it. The current `apply-engine.ts` "same-line ambiguity caveat" (first-occurrence replacement) is documented; promotion path is to upgrade to `ambiguity_count`-aware rejection alongside the formatter contract.

---

## 6. Synthesised 12-step path with open implementation questions

The minimum synthesis preserving every consensus claim (§ 2) and resolving every disagreement (§ 3) per the verdicts. Each step lists open implementation questions to settle in its plan PR (lifted from the per-source plan-PR Q1–Q10 lists; questions internal to a step's design, not reasons to defer the step).

### Step 1 — Doc reframe (XS)

Replace [`roadmap.md`](../roadmap.md) Floors row 45 with two distinct rows per C2; sweep [`why-codemap.md`](../why-codemap.md) "When to reach for something else" line 22 to drop "fix patches" from the list `knip`/`jscpd`/`eslint --fix` own.

**Source ancestry:** C1, C2; all six positions.

**Open questions:**

1. Two distinct rows or one row with two clauses? Bias toward two distinct rows — they're independent product-class decisions and each should grep / cite cleanly.
2. Lift any salvageable text from the existing row 45 ("Adjacent to Moat A" framing)? Yes — both new rows reference Moat A.

### Step 2 — Three more diff-shape recipes (S × 3)

Ship `replace-marker-kind` (params `from`/`to`; joins `markers.line_number` + `content`), `migrate-import-source` (params `old`/`new`; joins `imports.line_number` + `source`), `add-jsdoc-deprecated` (params `name`/`replacement`; inserts above `symbols.line_start`). Pure SQL + frontmatter; no engine work, no schema change.

**Source ancestry:** C5; A1; recipe candidates from [§ 4.3](#43-recipe-additions).

**Open questions:**

1. Ship the 3 in one PR or sequential? Sequential keeps review small per [tracer-bullets](../../.cursor/rules/tracer-bullets.mdc).
2. Add `organize-imports` (A5; viable today) and `missing-exports` (A5; advisory) alongside, or hold for a second wave? Hold — keeps the first wave's review small.

### Step 3 — Per-row `actions[].command` template (S)

Extend `recipes-loader.ts` + `query-recipes.ts` so per-row `actions[]` carries a `command` template rendered with the recipe's params (e.g. `"codemap apply rename-preview --params old={{old}},new={{new}} --yes"`). Self-describing fixes; agents discover apply path from the row, not the catalog. Defers verb-alias decision until observed agent-host UX demand.

**Source ancestry:** C5; A1.

**Open questions:**

1. Template-rendering shape — reuse the existing param-resolution path from `recipe-params.ts` for consistency? Or a separate Mustache-style template engine? Bias toward reusing — same params, same renderer.
2. Block-list shape only or allow inline expressions? Block-list only matches existing `actions:` parser shape (no `js-yaml` dep).

### Step 4 — `auto_fixable` gating (S)

Flip the existing `actions[].auto_fixable` flag from advisory to enforcing. `apply` requires `auto_fixable: true` on the matching action OR explicit `--force` flag. Recipe authors opt in per fix.

**Source ancestry:** A2 (trust tiers extension), A5 (default false), A6 (allowlist); § 3.4 verdict.

**Open questions:**

1. Migration: existing recipes with `auto_fixable: false` (most of the catalog) reject by default. Confirm this is the desired migration shape, or grandfather existing recipes?
2. `--force` flag rejection of phase-2 conflicts — preserve or ignore? Preserve — `--force` only bypasses the `auto_fixable` gate, not phase-1 conflict detection.

### Step 5 — `calls.{line_start, column_start}` substrate column (S) — ✓ Shipped 2026-05-15

**What shipped:** [`substrate-extraction.md` Tier 1 Slice 1.A](../plans/substrate-extraction.md#tier-1--position-precision-on-existing-tables--shipped-2026-05-14) — `calls.{line_start, column_start, column_end}` + bundled `find-call-sites` recipe. Proposed call metadata (`args_count`, `is_method_call`, `is_constructor_call`, `is_optional_chain`) did not ship in the live schema.

Single oxc visitor extension reusing existing `buildLineMap` / `offsetToLine` from `parser.ts`; schema bump triggers one-shot reindex.

**Source ancestry:** C3; all six positions; per § 4.1.

**Open questions:**

1. Schema delta: NULL columns for back-compat or strict NOT NULL with one-shot migration? Bias toward NOT NULL — clean schema; one-shot reindex on consumer upgrade is acceptable.
2. Column tracking on the existing visitor walker — record `node.start` only (line + col_start) or also `node.end` (col_end)? A5 explicit on col_end; cheap; record both.
3. Same migration shape for inherited tables (`calls` is referenced by `dependencies` indirectly via files)?

### Step 6 — App-wide rename recipe (S, depends on Step 5)

Extend `rename-preview.sql` with a `call_rows` CTE joining `calls` × `symbols`. Same recipe id; new `location_kind = 'call_site'`. ~80% coverage of an app-wide rename (definition + import specifier + call site).

**Source ancestry:** C3; A1, A5.

**Open questions:**

1. Single recipe (extend `rename-preview.sql`) or new recipe (`rename-app-wide.sql`)? Bias toward extending — keeps the agent's mental model "one rename recipe", not "two renames with overlap".
2. The `.md` "What v1 covers" / "does not cover" sections re-balance — preserve the explicit gap list (re-exports, JSX, default-import binds) per [§ 5.6 honest-v1 framing](#56-honest-v1-rename-framing-from-a6).

### Step 7 — `exports.{line_start, column_start}` + extend `rename-preview.sql` with `re_export_rows` CTE (S) — ✓ Shipped (partial) 2026-05-15

**What shipped:** Substrate column part shipped as [`substrate-extraction.md` Tier 1 Slice 1.B](../plans/substrate-extraction.md#tier-1--position-precision-on-existing-tables--shipped-2026-05-14) — `exports.{line_start, line_end, column_start, column_end, is_re_export}` + bundled `find-export-sites` recipe. Re-export chain walking landed in [Tier 2.2](../plans/substrate-extraction.md) via the `re_export_chains` materialised table (10-hop bound, cycle detection), and `bindings-engine` resolves through it. **Open:** the `rename-preview.sql` recipe extension itself — the substrate is in place; the recipe-side `re_export_rows` CTE is the remaining work.

Mirror of Step 5 for the exports table. Closes the second rename-preview substrate gap (re-export alias chains; barrel-safe rewrites).

**Source ancestry:** C4; all six positions; per § 4.1.

**Open questions:**

1. Combine with `re_export_source` column (already exists on `exports`) for chain resolution? Yes — JOIN through `re_export_source` to reach the originating definition.
2. Multi-hop alias chains — recursive CTE or single-hop only? Single-hop in v1; recursive CTE in a follow-up if the gap shows up.

### Step 8 — `apply --rows -` (CLI stdin) + `apply_rows` MCP/HTTP tool (M) — agent-in-the-loop unlock

Reads JSON array of `{file_path, line_start, before_pattern, after_pattern}` rows from stdin (CLI) or args (MCP/HTTP); validates against current disk via the existing phase-1 path; writes via the existing phase-2 path. Bridges LLM-edit / human-edit / codemod-edit through one safe-write substrate without crossing Moat A.

**Source ancestry:** § 3.3; A1, A3, A4 (highest-leverage). Per [§ 5.4 agent-angle gap](#54-agent-angle-gap-analysis-from-a4).

**Open questions:**

1. Stdin shape — JSONL (one row per line) or single JSON array? JSONL streams better for large inputs; array matches the `--json` envelope. Bias toward array (matches the format consumers already produce).
2. MCP tool — separate `apply_rows` tool or polymorphic `apply` (recipe-id OR rows)? Separate tool — runtime exclusivity check on the polymorphic version is brittle.
3. HTTP POST `/tool/apply_rows` body shape — match the MCP tool input verbatim.

### Step 9 — `apply --diff-input <file>` (S, sibling to Step 8)

Reads a unified diff, converts to row contract internally, runs same conflict pipeline as recipe-driven path. Two input shapes converge on the same engine. Completes the agent-in-the-loop substrate.

**Source ancestry:** § 3.3; A4.

**Open questions:**

1. Unified-diff parser — bring in a dependency (`parse-diff` etc.) or hand-roll? Hand-roll keeps the dep surface tight; spec is well-known.
2. Multi-file diff handling — atomic across files (per Step 9)? Same per-file atomicity (sibling-temp + rename) as today; cross-file rollback deferred to a later PR per existing `apply-engine.ts` design.

### Step 10 — `apply --commit "<msg>"` workflow flag (S)

Reuses engine; spawns `git add . && git commit -m <msg>` after a clean apply. Workflow integration; one-shot codemod-commits.

**Source ancestry:** § 4.5; A1.

**Open questions:**

1. Stage all changes or only files written by `apply`? Only the files apply touched — explicit allow-list passed to `git add`.
2. Commit-message templating with recipe params? Defer to v2 — basic `--commit "<msg>"` first.

### Step 11 — `--until-empty` apply-loop with `--max-passes N` cap (S)

Codemod-loop pattern; apply, reindex, re-run recipe, repeat until 0 rows or cap. Critical for one-rewrite-enables-another (e.g. `migrate-import-source` invalidates `barrel-files` rows → `apply barrel-files` finds new candidates).

**Source ancestry:** A1.

**Open questions:**

1. Default `--max-passes N` value — 10? 25? Lower (5) for safety, with explicit override?
2. Pass count in result envelope — extend `ApplyJsonPayload` with `passes: number` and `terminated_by: 'empty' | 'cap' | 'conflicts'`?
3. Termination on conflicts mid-loop — abort the whole loop or mark the pass and continue? Abort — phase-1 conflicts mean the recipe SQL is out of sync with disk; subsequent passes won't help.

### Step 12 — `apply.autoApplyRecipes` allowlist config (S)

`.codemap/config.{ts,js,json}` carries `apply.autoApplyRecipes: string[]`; recipes outside the list require interactive confirm even with `--yes`. Optional, opt-in operational discipline.

**Source ancestry:** § 3.4; A6.

**Open questions:**

1. Config field shape — flat list of recipe ids, or pattern-matchable (`auto-apply-glob: ['rename-*', 'migrate-*']`)? Flat list in v1; glob in v2 if requested.
2. Interaction with `--force` from Step 4 — does `--force` bypass the allowlist? Yes — `--force` is the universal escape hatch.

---

## 7. Rejected items with trigger conditions

Items rejected on architectural grounds (not on time/demand). Listing here so the rejection is grep-able from the synthesis and a future contributor doesn't re-litigate without seeing the prior verdict.

| Item                                                                                  | Source             | Why rejected                                                                                                                                                                                                              | Trigger to revisit                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Curated CLI write verbs (`codemap rename`, `codemap fix deprecated`, etc.)            | A2, A3             | § 3.1 verdict — premature; pro-verb sources disagree on cap (8–12 vs 3–5); read-side outcome-alias pattern requires recipe layer to land first.                                                                           | ≥3 diff-shape recipes shipping AND clear agent-host UX demand for verb-level discovery beyond `actions[].command` template.                                                                                                                                                                                                                          |
| Parallel `applyAstPayload()` AST engine (Path A)                                      | A5, A3 (long-term) | § 3.2 verdict — competes with `ts-morph` / `jscodeshift` on their home turf; AST printer maintenance burden in perpetuity; positioning blur; floor-disappearance makes product surface unbounded.                         | ≥2 of: (a) ≥3 external project teams hit substring-substitution wall on real recipes; (b) specific AST-shape transformation class requested with concrete consumer demand; (c) agent ecosystem moves toward AST-template-shaped patches AND substring contract becomes bottleneck; (d) Path B handoff seam friction motivates integrated AST writer. |
| Trust tiers (`safe` / `review` / `risky` taxonomy on recipes)                         | A2                 | § 3.4 verdict — adds taxonomy debt; the binary `auto_fixable` flag (Step 4) plus the `apply.autoApplyRecipes` allowlist (Step 12) covers the same use cases.                                                              | Allowlist proves insufficient AND ≥2 consumers ship `jq`-style trust filters in CI.                                                                                                                                                                                                                                                                  |
| Per-row confidence scores in `diff-json`                                              | A2                 | § 3.4 verdict — speculative; no consensus on computation method (heuristic per recipe? graph-derived? LLM-tagged?).                                                                                                       | A recipe ships where `before_pattern` matches multiple sites and the desired UX is per-site ranking.                                                                                                                                                                                                                                                 |
| Verifier as product surface (typecheck / lint / tests + expected structural delta)    | A3                 | § 3.4 verdict — scope creep into orchestration; consumer-side CI / pre-commit owns this; watch + reindex covers codemap-side structural verification.                                                                     | A consumer-driven plan PR articulates the verifier shape with concrete examples.                                                                                                                                                                                                                                                                     |
| Reliability loop (collect conflict-rate / apply-success metrics)                      | A2                 | § 3.4 verdict — needs telemetry surface; codemap doesn't ship telemetry upload (Floors row).                                                                                                                              | A consumer requests the shape with an offline / self-hosted observability target.                                                                                                                                                                                                                                                                    |
| Generalised `references` + `bindings` + `scopes` + `symbol_namespace` substrate       | A3, A4             | § 3.5 verdict — incremental position tables first; consolidate when ≥3 land AND a recipe wants UNION.                                                                                                                     | Third position-table lands AND a recipe wants to UNION across all three.                                                                                                                                                                                                                                                                             |
| `--branch` / `--output-patch` workflow flags                                          | A1                 | § 4.5 — nice-to-have; `--commit` (Step 10) is the priority workflow flag.                                                                                                                                                 | User reports of `--commit` being insufficient.                                                                                                                                                                                                                                                                                                       |
| Multi-line + kind-tagged row contract (`before_lines`, `kind: insert/delete/replace`) | A1                 | Postponed; the synthesis path covers single-line cases first. Multi-line is a contract extension after Step 11 ships.                                                                                                     | A recipe needs multi-line edits AND single-line workarounds prove insufficient.                                                                                                                                                                                                                                                                      |
| C.9 plugin layer entry-point integration with apply                                   | A5                 | Tracked in [`docs/plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md); already its own plan PR. Synthesis path doesn't depend on it; recipes that need entry-point awareness JOIN to `files.is_entry` once C.9 ships. | C.9 lands.                                                                                                                                                                                                                                                                                                                                           |
| Cross-file moves (`move_to: { file_path, line_start }`)                               | A1 mentions        | Higher risk than single-file edits; defer until single-file multi-line proves out.                                                                                                                                        | A recipe needs cross-file moves AND the alternative (delete-source + insert-dest as two operations) proves insufficient.                                                                                                                                                                                                                             |
| Cross-file atomic apply (pre-write backups + restore-on-throw)                        | A1 mentions        | Current per-file atomicity is fine for ≤10 files; defer until apply scales to 50+ files in real recipes.                                                                                                                  | A real `apply` invocation crosses 50 files AND a phase-2 I/O failure leaks partial state.                                                                                                                                                                                                                                                            |
| `codemap-to-tsmorph` adapter (Path B partner shim)                                    | A4                 | Not rejected — separable; ships independently of the main path. Codemap-side surface is `apply --rows -` (Step 8) — adapter lives in user-side glue.                                                                      | Independent; ship anytime as a separate package experiment after Step 8.                                                                                                                                                                                                                                                                             |

---

## 8. Preserved moats (universal)

Every position preserves these. The synthesis path ships nothing that violates them.

- **No `severity` on `apply` rows.** Recipes propose; codemap never decides "this should be fixed". `auto_fixable` (Step 4) is a recipe-author opt-in per fix, not a global policy.
- **No suppression-by-default.** Existing `// codemap-ignore-{next-line,file} <recipe-id>` machinery is opt-in substrate.
- **No JS execution at apply time.** Recipes are SQL. Row contracts are static data. Step 8's agent-in-the-loop validates LLM output as data, never `eval`s it.
- **No opinion about which fixes to run.** Codemap is the executor, not the policy engine. Same as `audit` not shipping a `verdict` until 2 consumers ship `jq` thresholds.
- **No codemod-tool ambition.** We don't ship a JS API for transforms (`jscodeshift` / `ast-grep` / `comby` own that). We ship SQL as the API and a substrate executor; Path B (§ 3.2) covers the AST-shape work via partnership, not absorption.
- **No telemetry upload.** A2's reliability-loop concept stays deferred per the [`roadmap.md`](../roadmap.md) Floors row.

The "no fix engine" line was right about the **product class**; it was wrong about the **engine shape**. Splitting that distinction in Step 1 unlocks the entire growth path without breaking [Moat A](../roadmap.md#moats-load-bearing) or [Moat B](../roadmap.md#moats-load-bearing).

---

## 9. Status / lifecycle

Per [`docs-governance § Closing research`](../../.agents/skills/docs-governance/SKILL.md#closing-research):

- **When the synthesis path ships any step:** add a one-line "What shipped" appendix under that step in [§ 6](#6-synthesised-12-step-path-with-open-implementation-questions) linking to the lift destination (`architecture.md` / `glossary.md` / `roadmap.md`); slim duplicated prose.
- **When all 12 steps ship or close:** retire this note per [`docs/README.md` Rule 8](../README.md). Lift any durable strategic claim (Path A vs B framing; agent-in-the-loop substrate positioning) into [`why-codemap.md`](../why-codemap.md) or [`research/non-goals-reassessment-2026-05.md`](./non-goals-reassessment-2026-05.md) before deletion.
- **When a deferred / rejected item triggers** (per § 7 trigger conditions): open a plan PR with this note as the rationale anchor; this synthesis is the disagreement record that justifies the trigger.
- **Annual re-evaluation** — re-run the triangulation against the substrate / recipe count of the day; update verdicts with current data.

**Provenance:** Six source notes (three plan PRs + three research notes) were merged into this single document. Their unique substrate proposals, recipe candidates, engine extensions, argumentation chains, and reference views are inlined above with author attribution preserved (A1–A6 labels). The originals were deleted in the same commit that authored this consolidated version — `git log --follow` reconstructs the merge history if any future reader wants the per-source view back.

---

## 10. Primitive sources + internal cross-references

### Primitive sources cited from the synthesis path (per [`plan-pr-inspiration-discipline`](../../.agents/rules/plan-pr-inspiration-discipline.md))

| Source                                                                                                                           | Relevance                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [oxc parser](https://oxc.rs) AST node reference                                                                                  | Step 5 `calls.{line_start, column_start}` extraction; future `import_specifiers` / `jsx_usages` walker shape                                                                                                                                           |
| [SQLite docs § STRICT tables](https://www.sqlite.org/stricttables.html)                                                          | Step 5 / 7 schema deltas — `STRICT` discipline preserved across new columns                                                                                                                                                                            |
| [SQLite docs § FTS5](https://www.sqlite.org/fts5.html)                                                                           | Not used in this synthesis; called out so future steps consulting it know to cite                                                                                                                                                                      |
| [String.prototype.replace § GetSubstitution](https://tc39.es/ecma262/#sec-getsubstitution)                                       | Multi-line handling in deferred row-contract extension — the `$`-pre-escape behavior must extend to multi-line `before_pattern`                                                                                                                        |
| [Unified diff format § hunk headers](https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html)              | Step 9 `apply --diff-input` parser shape                                                                                                                                                                                                               |
| [LSP `WorkspaceEdit`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspaceEdit) | Future cross-fertilisation with [`plans/lsp-diagnostic-push.md`](../plans/lsp-diagnostic-push.md) — `code_action` payloads can ride this synthesis's `apply --rows -` shape; A3's action-runtime shape (deferred) cites this as the long-term contract |
| [JSON-RPC 2.0](https://www.jsonrpc.org/specification)                                                                            | Step 8 `apply_rows` MCP tool envelope                                                                                                                                                                                                                  |

### Internal anchors cited from this synthesis

- [`roadmap.md` Floors](../roadmap.md#floors-v1-product-shape) — current "No fix engine" floor (Step 1 target)
- [`roadmap.md` Moats](../roadmap.md#moats-load-bearing) — Moat A reviewer test (consensus C6)
- [`roadmap.md` Backlog](../roadmap.md#backlog) — `audit verdict` deferral precedent for § 3.5 verdict
- [`architecture.md` Apply wiring](../architecture.md#cli-usage) — the engine the synthesis path grows the substrate around
- [`glossary.md` Substrate-shaped fix executor](../glossary.md) — current canonical definition (preserved)
- [`why-codemap.md` § When to reach for something else](../why-codemap.md#when-to-reach-for-something-else) — Step 1 secondary target (drop "fix patches" from the list)
- [`research/non-goals-reassessment-2026-05.md`](./non-goals-reassessment-2026-05.md) — precedent for floor-flips after architectural reality outpaces docs
- [`docs/plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md) — C.9 entry-point work; orthogonal to synthesis path
- [`docs/plans/lsp-diagnostic-push.md`](../plans/lsp-diagnostic-push.md) — sibling plan; Steps 8–9 (agent-in-the-loop) and the LSP `code_action` shape converge naturally

### Adjacent skills + rules

- [`docs-governance` skill](../../.agents/skills/docs-governance/SKILL.md) — lifecycle prescription (§ 9)
- [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md) — every step in [§ 6](#6-synthesised-12-step-path-with-open-implementation-questions) should pass the moat / boundary checks the skill enforces
- [`tracer-bullets`](../../.cursor/rules/tracer-bullets.mdc) — every step here is one tracer-bullet PR; never build all 12 in isolation
- [`codemap.mdc`](../../.cursor/rules/codemap.mdc) — outcome-alias cap (5) is the read-side precedent that shapes § 3.1 verdict
- [`plan-pr-inspiration-discipline`](../../.cursor/rules/plan-pr-inspiration-discipline.mdc) — primitive-source discipline; partnered codemod tools (Path B) cite their inspiration from JSON-RPC / LSP `WorkspaceEdit` specs, not from peer-tool source paths
- [`agents-tier-system`](../../.agents/rules/agents-tier-system.md) — durability rules respected throughout (no source-line citations; symbol references and design intent only)
