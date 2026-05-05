# C.9 Framework plugin layer — plan

> **Status:** open · ships last in the cadence after § 1.5 / § 1.10 / § 1.9 / § 1.6 — per [`research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) Rationale 4 (orthogonality of small picks). Closed-dead-subgraph caveat motivating this plan: [`research note § 2.3`](../research/non-goals-reassessment-2026-05.md#23-no-static-analysis).
>
> **Motivator:** **closed-dead-subgraph case** — N-file packs where every file imports a sibling (non-zero `dependencies` fan-in for all) but none is reachable from a real entry point. Today's `untested-and-dead` recipe false-positives Next.js `app/**/page.tsx` files for the same reason: framework entry points aren't recognized as live without per-framework awareness. This plan proposes the smallest plugin contract that closes the gap.
>
> **Tier:** XL effort (per the research note's § 5 (b) row). Shipping cadence is sequential after (a) + (c); this plan iterates in parallel so impl is unblocked when its slot arrives.

---

## Pre-locked decisions (from non-goals-reassessment grill)

These are committed to v1. Questions opened against them must justify against the linked decisions.

| #   | Decision                                                                                                                                                     | Source                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| L.1 | **Entry-point hints only** (Shape A — `glob → is_entry: true` annotations on `files`). No arbitrary `dependencies` edge injection.                           | Q4 resolved (lifted); [§ 2.3 caveat](../research/non-goals-reassessment-2026-05.md#23-no-static-analysis) |
| L.2 | **Static config only** — plugins describe rules in static config (globs, glob → annotation mappings). No JS evaluation at index time.                        | [Floor "No JS execution at index time"](../roadmap.md#floors-v1-product-shape)                            |
| L.3 | **Moat-A clean** — recipes consume the new substrate via SQL; no new verdict-shaped CLI verbs.                                                               | [Moat A](../roadmap.md#moats-load-bearing)                                                                |
| L.4 | **Moat-B aligned** — `is_entry` annotation IS substrate growth (richer extracted structure on `files`). New schema column or table.                          | [Moat B](../roadmap.md#moats-load-bearing)                                                                |
| L.5 | **No edge injection in v1** — defer to v2 if a real recipe demands it; backwards-compat preserved (additive). Mirrors `query_baselines` deferral discipline. | Q4 resolved (lifted)                                                                                      |

---

## Open decisions (iterate as the plan converges)

These are the design questions the plan-PR resolves before impl starts (per the parallel-plan-PR shape). Each gets a section below as it crystallises.

- **Q1 — Plugin contract shape.** JSON schema (declarative)? Zod-validated TS module (typed)? Markdown-with-frontmatter (mirrors recipe-as-content registry per PR #37)? What fields beyond `entry_globs`?
- **Q2 — Plugin discovery mechanism.** npm peerDep registration (mirrors community-adapter pattern from [`roadmap.md § Strategy`](../roadmap.md#strategy))? Path-glob auto-discovery from `<projectRoot>/.codemap/plugins/`? Config-listed (`.codemap/config.ts` `plugins: [...]`)? Some combination?
- **Q3 — Schema delta.** `is_entry INTEGER DEFAULT 0` column on `files` (single boolean) vs separate `entry_annotations(file_path, plugin_id, reason)` table (multiple plugins can co-annotate; preserves provenance). The latter is moat-B-aligned but slightly more storage.
- **Q4 — Reachability sweep algorithm.** BFS from `is_entry` files over `dependencies`? Materialised `is_reachable` column (cheap reads, expensive write)? On-demand recursive CTE (no materialisation; might be slow on big graphs)? Cache invalidation strategy?
- **Q5 — Bundled starter plugins for v1.** Next.js (`app/**/page.tsx`, `pages/**/*.{ts,tsx}`, `app/**/layout.tsx`, etc.)? Vite (`vite.config.{ts,js}`, HTML `<script src>`)? Storybook (`*.stories.{ts,tsx}`)? Vitest config? TanStack Router (`__root.tsx`, route files)? Bundle 1, 2, or 3 starters? **Repo-structure interaction:** if starter plugins ship as separate packages (e.g. `codemap-plugin-nextjs`), monorepo conversion enters scope per [`lsp-diagnostic-push.md § Repo-structure tradeoffs`](./lsp-diagnostic-push.md#repo-structure-tradeoffs-canonical-home-for-the-monorepo-vs-flat-decision).
- **Q6 — Plugin loading order / conflict resolution.** What if two plugins match the same file (e.g. both Next.js + Vite plugins claim `vite.config.ts` is an entry)? Union of annotations? Conflict error? First-match-wins by load order? Likely "union" for entry hints (annotations compose; multiple-marking is fine).
- **Q7 — Composition with project-local recipes.** Project-local recipes can already JOIN `files` — they get `is_entry` for free. Anything else needed?
- **Q8 — Minimal API surface for community plugins.** What's the smallest contract that lets someone publish a `codemap-plugin-tanstack-router` package without forking core? Mirrors community-adapter discipline; same lever. **Repo-structure interaction:** community plugins as separate npm packages is one of the four triggers for converting codemap-itself to a monorepo — see [`lsp-diagnostic-push.md § When to revisit`](./lsp-diagnostic-push.md#when-to-revisit-triggers-not-preferences).
- **Q9 — Backwards-compat for projects without plugins.** Reachability sweep + `is_entry` should default to "all files reachable" (current behaviour) when no plugins are loaded, so existing recipes don't change semantics. Verify the SQL wording handles this cleanly.

Each open decision will get a "Resolution" subsection below as it crystallises (mirrors the research-note's § 6 pattern).

---

## High-level architecture

Three new pieces; each composes with existing infrastructure:

1. **Plugin loader** (Q1, Q2) — scans for plugin files at index startup; validates against the contract schema; produces a list of `(glob, is_entry)` annotations.
2. **Indexer hook** (Q3) — at index time, after `files` rows are inserted, the loader's annotations are matched against file paths and the relevant rows get `is_entry = 1` (or rows are inserted into `entry_annotations`, depending on Q3).
3. **Reachability sweep** (Q4) — either materialised at index time (column on `files`) or computed on demand by recipes (recursive CTE). Slice-1 likely starts on-demand; promote to materialised if perf demands.

No CLI changes. No new verb. Recipes consume the new substrate.

## What C.9 sharpens — and what it doesn't

Per the [research note § 5 errata (2026-05)](../research/non-goals-reassessment-2026-05.md#8-triangulation-errata-2026-05): the original framing claimed C.9 "sharpens every shipped recipe" and that the LSP shim (§ 2.5 / item (d)) blocks on C.9's entry-point awareness. Both were wrong. (d) was reframed across three revisions (v1 "thin shim, agent UX" → v2 "orthogonal, ship before (b)" → v2.5 "dropped" → v3 "diagnostic-push server + VSCode extension, ships after (b)"); see same errata for the full evolution. Accurate scope:

**C.9 sharpens (recipe layer):**

- `untested-and-dead` — currently false-positives Next.js `app/**/page.tsx` and similar framework files. Reachability sweep from `is_entry = 1` files closes the gap.
- `unimported-exports` — false-positives barrel-only consumption + framework-only-imported exports. Same reachability path closes a subset of the gap (re-export chain following is a separate axis tracked in the recipe's own `.md`).
- One hypothetical future recipe — `dead-files-by-reachability` (Slice 2 below) — closes the closed-dead-subgraph case directly.

**C.9 does NOT sharpen:**

- **(d) LSP diagnostic-push server + VSCode extension** (§ 2.5 — ships after C.9 per § 5 v3 cadence) — **complementary, not orthogonal**. Standard LSP request handlers (`textDocument/references` / `definition`) are NOT what (d) ships, so `is_entry` doesn't ride those response shapes. But (d)'s `Diagnostic[]` push for `untested-and-dead` and `unimported-exports` (recipes that ask "is this live?") **inherits C.9's false-positive class** — without entry-point awareness, those diagnostics squiggle on Next.js `page.tsx` files. C.9 landing first means (d) ships with cleaner diagnostic precision from day one. (d) can ship without C.9 (diagnostics carry the same caveats the recipes already document); landing C.9 first is just better UX.
- Boundary recipes (item 1.5) — query "who imports whom"; reachability is irrelevant.
- Hotspot recipes (`fan-in`, `fan-out`) — rank by structural fan; not "is this live."
- Complexity recipes (item 1.3) — query `symbols.complexity`; orthogonal.
- Call recipes (`calls`) — query who-calls-what; orthogonal.
- Marker / CSS recipes — orthogonal substrates.

This narrowing is why the research-note ship sequence pushes (b) C.9 last: every other planned item ships against substrate that doesn't depend on C.9.

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

1. **Slice 1: schema delta + manual `is_entry` annotation.** Resolve Q3 minimally (probably `is_entry INTEGER DEFAULT 0` on `files` for v1; promote to a separate table in v2 if multi-plugin provenance becomes valuable). Hard-code one Next.js-style glob in the test fixture for now. Verify via `codemap query "SELECT path FROM files WHERE is_entry = 1"`. No plugin discovery yet.
2. **Slice 2: reachability sweep recipe.** New bundled `dead-files-by-reachability.sql` walks `dependencies` from `is_entry = 1` files; flags any unreachable file. Test against the closed-dead-subgraph fixture (N-file pack with self-imports + zero entry-marked files → all N flagged).
3. **Slice 3: plugin contract + discovery.** Resolve Q1 + Q2; ship the contract; load one starter plugin from the chosen discovery surface. End-to-end: real plugin file → annotations applied → reachability recipe returns correct results.
4. **Slice 4: bundled starter plugin(s).** Resolve Q5 — ship 1-3 starter plugins (Next.js minimum). Cross-fixture tested.
5. **Slice 5: docs + agent rule update.** Per [`docs/README.md` Rule 10](../README.md), update bundled agent rule + skill in lockstep — agents need to know about `is_entry` and the reachability recipe.

---

## Test approach

- **Unit:** plugin loader, glob matcher, reachability sweep — `*.test.ts` per touched file (per [`verify-after-each-step`](../../.agents/rules/verify-after-each-step.md)).
- **Golden queries:** add `dead-files-by-reachability` golden expectations to `fixtures/golden/scenarios.json` per [`docs/golden-queries.md`](../golden-queries.md).
- **Integration fixture:** `fixtures/golden/c9-fixture/` containing:
  - 1 Next.js-style `app/page.tsx` entry
  - N-file widget pack (closed-dead-subgraph reproducer)
  - Expected output: N unreachable files flagged; `app/page.tsx` reachable.

---

## Risks / non-goals

| Item                                                     | Mitigation                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-goal:** edge injection via plugins (v2).           | Per L.5; deferred. If demand emerges, additive in v2.                                                                                                                                               |
| **Non-goal:** verdict-shaped CLI verb.                   | Per L.3; recipe + `--format sarif` already covers CI gating.                                                                                                                                        |
| **Risk:** plugin contract over-engineered.               | Slice 3 ships the smallest contract; iterate based on real plugin-author feedback (community plugins are the leverage signal).                                                                      |
| **Risk:** bundled starter-plugin maintenance.            | Limit v1 to 1-2 plugins; document community-plugin path clearly so contributors take over framework-specific knowledge. Mirrors community-adapter discipline.                                       |
| **Risk:** false-positives from misdeclared entry points. | Plugins are opt-in (project lists them in config or installs as peerDep); reachability recipe output is advisory until users verify. Cross-ref item 1.6 advisory-recipe pattern from research note. |
| **Risk:** plan abandoned mid-iteration.                  | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. Design surface captured either way.                                                               |

---

## Cross-references

- [`docs/research/non-goals-reassessment-2026-05.md § 2.3`](../research/non-goals-reassessment-2026-05.md#23-no-static-analysis) — closed-dead-subgraph caveat (analytical history). Moats lifted to [`roadmap.md § Non-goals (v1) → Moats`](../roadmap.md#moats-load-bearing); pick-order rationale (especially the (b) before (d) reasoning) at [`§ 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical).
- [`docs/architecture.md`](../architecture.md) — schema reference (where `is_entry` lands)
- [`docs/golden-queries.md`](../golden-queries.md) — golden-query test pattern
- [`docs/roadmap.md § Strategy`](../roadmap.md#strategy) — community-adapter precedent (Q2 / Q8 use the same lever)
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location)
- [`docs/README.md` Rule 10](../README.md) — agent rule lockstep update (Slice 5)
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence
- [`.agents/rules/verify-after-each-step.md`](../../.agents/rules/verify-after-each-step.md) — per-slice check discipline
