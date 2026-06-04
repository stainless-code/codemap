# Substrate & apply utilization — gap diagnosis + doc/execution plan

> **Status:** open — Phase A/B hygiene slice shipped on `feat/apply-engine-slices` (items 1–10 below). Synthesizes 2026-06 apply/substrate exploration (14 parallel codebase audits). **Does not** replace [`apply-engine-direction.md`](./apply-engine-direction.md) (executor shipped) or [`substrate-extraction.md`](./substrate-extraction.md) (tiers 7–13 open).
>
> **Motivator:** Steps 2–12 of the apply-engine landed, but agents and humans still experience codemap as “query + one rename recipe.” This plan answers whether we are using **indexed substrate** and **apply** to their designed capacity, and sequences **documentation** + **recipe/test** work to close the gap without violating [Moat A](../roadmap.md#moats-load-bearing) / [Moat B](../roadmap.md#moats-load-bearing).

---

## Executive answer (grill this first)

| Layer                     | Using full capability? | One-line why                                                                                                                                                                                                                           |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Substrate (tiers 1–6)** | **Partially**          | Rich tables exist (`references`, `bindings`, `jsx_*`, `import_specifiers`, `jsdoc_tags`, …) but **only a thin slice** is JOIN’d by shipped diff-shape recipes. Tiers **7–13** are intentionally unshipped — not a utilization failure. |
| **Apply executor**        | **Mostly yes**         | Phase-1/2 engine, three CLI input modes, MCP `apply` + `apply_rows`, policy gates, fixpoint loop — **shipped and engine-heavy in tests**.                                                                                              |
| **Apply recipes**         | **No**                 | **4 of 62** bundled SQL recipes emit the diff row contract; **3** are `auto_fixable: true`. The product bottleneck is **recipe surface**, not executor plumbing.                                                                       |
| **Agent/consumer docs**   | **No**                 | README, `templates/agent-content`, synthesis archive, and parts of `rename-preview.md` still describe pre–Step 8–12 reality.                                                                                                           |
| **Verification**          | **No**                 | Goldens assert **query rows**, not disk apply; CLI E2E is effectively **`rename-preview` only**.                                                                                                                                       |

**Conclusion:** We built a **general substrate-shaped apply platform** and indexed a **broad AST→SQLite graph**, but we **under-utilize both** on the user-visible path: recipes don’t read most substrate; docs don’t describe what shipped; one recipe (`replace-marker-kind`) is **broken against indexer shape**. Closing the gap is **wave-2 recipes + doc lift + targeted tests/fixes**, not another apply-engine step.

---

## Utilization model (how to read “full capability”)

### Substrate

**Designed capacity** ([`substrate-extraction.md`](./substrate-extraction.md), [`architecture.md § Schema`](../architecture.md#schema)): tiers 1–6 shipped so recipes can JOIN position-precise calls/imports/exports, bindings graph, JSX, behavioral facts, module flags, `re_export_chains`, etc.

**Actual utilization today (apply-relevant):**

| Substrate cluster                          | Shipped in index?      | Used by shipped apply SQL?                                           | Used by read recipes (feeds apply)?                   |
| ------------------------------------------ | ---------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| `symbols` positions + `doc_comment`        | Yes                    | `rename-preview`, `add-jsdoc-deprecated` (positions only for latter) | `deprecated-symbols`, many audits                     |
| `imports` + `specifiers` + `resolved_path` | Yes                    | `rename-preview` (direct importers), `migrate-import-source`         | `find-import-sites`, barrel audits                    |
| `calls` + `provenance`                     | Yes                    | `rename-preview` (`call_rows`, AST only)                             | `find-call-sites`, `call-path`                        |
| `exports` + `re_export_chains`             | Yes                    | `rename-preview` (single-hop `re_export_rows`)                       | `barrel-chains`, `find-re-exported-bindings`          |
| `markers`                                  | Yes                    | `replace-marker-kind` (**SQL/filter mismatch** — see § P0)           | `markers-by-kind`                                     |
| `references` / `bindings` / `scopes`       | Yes                    | **No** apply recipe                                                  | `find-symbol-references`, `find-re-exported-bindings` |
| `jsx_elements` / `jsx_attributes`          | Yes                    | **No**                                                               | `find-jsx-usages`                                     |
| `import_specifiers` (child table)          | Yes                    | **No** (stale-imports backlog)                                       | —                                                     |
| `jsdoc_tags`                               | Yes (partial tier 4/5) | **No** (`add-jsdoc` is text template, not tag-aware)                 | `find-throws-jsdoc`                                   |
| Tiers **7–13**                             | Open                   | N/A                                                                  | Future recipes                                        |

**Verdict:** Substrate is **over-built relative to apply recipes** (good for Moat B) but **under-exposed** on the write path. Read path uses more tables; write path uses **four narrow JOIN patterns**.

### Apply

**Designed capacity** ([`apply-engine-direction.md`](./apply-engine-direction.md), [`glossary.md`](../glossary.md)): recipe / rows / diff-input → validate → write; optional fixpoint + commit; `actions[].command`; `auto_fixable` + allowlist; MCP subset.

**Actual utilization:**

| Capability                          | Code                  | Docs                                                    | Recipes                    | Tests                                  |
| ----------------------------------- | --------------------- | ------------------------------------------------------- | -------------------------- | -------------------------------------- |
| `applyDiffPayload`                  | Shipped               | Partial (`glossary` strong; `architecture` recipe-only) | All 4 diff recipes         | **Strong** (`apply-engine.test.ts`)    |
| Recipe apply                        | Shipped               | README rename example                                   | 4 ids                      | **Weak** (mostly `rename-preview` CLI) |
| `--rows` / `apply_rows`             | Shipped               | **Absent** consumer                                     | Agent loop                 | **None**                               |
| `--diff-input`                      | Shipped               | CLI help only                                           | Bridge from external diffs | **Minimal** (parser unit)              |
| `--until-empty`                     | CLI only              | Plan/roadmap                                            | Fixpoint codemods          | **None**                               |
| `--commit`                          | CLI only              | Plan/roadmap                                            | One-shot git               | **None**                               |
| `actions[].command`                 | Shipped on query JSON | **4 recipes**; skill omits `command`                    | 4 templates                | Template unit only                     |
| Policy (allowlist + `auto_fixable`) | Shipped               | Config Zod only                                         | 3 auto + 1 force           | Partial (`auto_fixable` only)          |

**Verdict:** Apply **executor ≈ 85% utilized**; **recipe catalog ≈ 6% of SQL files apply-shaped**; **agent docs ≈ 40% of shipped surface**.

---

## Known defects (not “under-utilization” — bugs)

| Issue                                  | Symptom                                                  | Root cause                                                                           | Track as                                                                       |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **`replace-marker-kind` empty golden** | Scenario expects TODO→FIXME; golden `[]`                 | SQL `content LIKE '%kind%'` but indexer stores marker **content without kind token** | **P0 fix** (recipe SQL or extractor) before doc claims apply works for markers |
| **`rename-preview.md` drift**          | Text says call/re-export “not covered”                   | SQL + golden include `call_site` / could include `re_export`                         | **P1 doc fix**                                                                 |
| **Synthesis §4.4 stale**               | Says `--rows`, `--diff-input`, until-empty “not shipped” | Plan/roadmap/code shipped                                                            | **P1 doc hygiene** (status header + slim open section)                         |
| **MCP tool count “17”**                | Consumer tables omit `apply_rows`                        | Allowlist has 18 tools                                                               | **P1 consumer doc**                                                            |

---

## Gap matrix → work type

| Gap                                                                                      | Type                                | Suggested owner plan / doc                                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Wave-2 diff-shape recipes (`organize-imports`, `stale-imports`, `migrate-deprecated`, …) | **Implementation** (tracer bullets) | This plan § Phase C; synthesis §4.3                                                               |
| `rename-app-wide` (JOIN `references`/`bindings`)                                         | **Implementation**                  | Substrate-extraction capability matrix; new recipe PR                                             |
| Barrel-consumer import rename                                                            | **Recipe design**                   | Extend `rename-preview` or sibling recipe                                                         |
| Consumer apply docs                                                                      | **Documentation**                   | This plan § Phase A                                                                               |
| Close `apply-engine-direction.md`                                                        | **Lifecycle**                       | Delete + lift per [`docs/README.md` Rule 8](../README.md) after Phase A                           |
| Apply E2E + `apply-run` tests                                                            | **Testing**                         | This plan § Phase B                                                                               |
| MCP `until_empty`                                                                        | **Deferred**                        | Only if agent-host demand after doc pass                                                          |
| Substrate tiers 7–13                                                                     | **Separate**                        | [`substrate-extraction.md`](./substrate-extraction.md) — not blocking apply utilization narrative |

---

## Doc plan (execute after grill)

Phases are **documentation-first** so consumer surfaces match code before more recipes ship. Implementation phases can overlap once Phase A scope is locked.

### Phase A — Truth sync (maintainer + consumer)

**Goal:** One authoritative story: “what apply is today” and “what substrate apply recipes use.”

| Step | Action                                                                                                                                                                                              | Canonical home after lift                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A.1  | **Expand `architecture.md` § Apply wiring** — three input modes, transport matrix (CLI vs MCP/HTTP), policy layers, fixpoint envelope fields, explicit non-goals (no AST apply).                    | Stays in `architecture.md`                         |
| A.2  | **Expand `glossary.md` § `codemap apply`** — `apply_rows`, `--diff-input`, `--until-empty`, `--commit`, `--force`, `apply.autoApplyRecipes`, `passes` / `terminated_by`.                            | Stays in `glossary.md`                             |
| A.3  | **README § CLI** — apply subsection: three modes + link to recipe catalog; MCP **18 tools** with `apply_rows`.                                                                                      | Root `README.md`                                   |
| A.4  | **`templates/agent-content`** — `skill/10-recipes-context.md`, `mcp-instructions.md`: `apply` + `apply_rows` params; `actions[].command`; `auto_fixable` write gate; discover→dry_run→apply loop.   | Served live via `codemap skill`                    |
| A.5  | **Fix `rename-preview.md`** — v1 coverage matches SQL (calls, single-hop re-exports); barrel-consumer gap explicit.                                                                                 | Recipe frontmatter                                 |
| A.6  | **Synthesis research note** — topmatters: Steps 2–12 shipped; §4.4 engine table → “shipped” or move to rejected/historical; agent gap table refresh.                                                | Keep until grill decides delete vs rejected header |
| A.7  | **`codemap.config.example.json`** — optional `apply.autoApplyRecipes` example.                                                                                                                      | Example config                                     |
| A.8  | **Close `apply-engine-direction.md`** — lift rejected-items table + moats to this plan § “Preserved constraints”; delete plan file; roadmap item stays [x] with link here until wave-2 plan exists. | This file § Preserved constraints                  |

**Phase A exit criteria:** `rg "not shipped|17 tools"` on consumer surfaces returns zero false negatives for apply Steps 8–12; `codemap skill` output mentions `apply_rows` and row-input path.

### Phase B — Verification docs + tests (maintainer)

| Step | Action                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| B.1  | **`testing-coverage.md`** — apply harness map: unit (`apply-engine`, policy, diff-input, template), CLI E2E scope, golden = query-only, gaps list.    |
| B.2  | **Tracer tests** — `apply-run` or CLI: `--rows` round-trip; `assertApplyAllowlist`; one non–`rename-preview` recipe dry-run/apply on minimal fixture. |
| B.3  | **Golden** — fix `replace-marker-kind` fixture/SQL **or** document intentional empty + change scenario prompt.                                        |
| B.4  | **Optional golden** — `rename-preview` row with `location_kind: re_export` once minimal fixture has barrel chain.                                     |

**Phase B exit criteria:** CI covers all three CLI input modes at least once; all four diff-shape recipes have non-empty golden **or** documented intentional empty with SQL comment.

### Phase C — Recipe utilization (implementation; post-doc)

Prioritized by **substrate already indexed** (no tier 7–13 dependency):

| Priority | Recipe                                                 | Substrate                                | Effort | Notes                                |
| -------- | ------------------------------------------------------ | ---------------------------------------- | ------ | ------------------------------------ |
| C.1      | Fix **`replace-marker-kind`**                          | `markers`                                | S      | Unblocks honest marker apply story   |
| C.2      | **`organize-imports`**                                 | `imports`                                | S      | Wave-2; single-file sort             |
| C.3      | **`stale-imports`**                                    | `import_specifiers` or conservative JSON | M      | Needs design PR for safety           |
| C.4      | **`migrate-deprecated` / `deprecated-usages`**         | `doc_comment` + `calls`                  | M      | Pairs with read `deprecated-symbols` |
| C.5      | **`rename-app-wide` or barrel import rows**            | `references` / `bindings`                | M–L    | Closes rename-preview barrel gap     |
| C.6      | More `actions[].command` on high-traffic audit recipes | —                                        | S each | Only where diff SQL exists           |

Each C.\* item = **one tracer-bullet PR**: SQL + `.md` + golden + `auto_fixable` decision + skill cross-link if user-visible.

**Phase C exit criteria:** At least **two** new diff-shape recipes beyond the original four; `rename-preview` golden covers `re_export` or documented limitation removed.

### Phase D — Optional transport parity (trigger-gated)

| Item                                | Trigger                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| MCP `until_empty`                   | ≥2 agent-host requests or internal dogfood fixpoint loops without shell |
| MCP/HTTP `--diff-input`             | Demand after `apply_rows` documented                                    |
| `ambiguity_count` on diff-json rows | Same-line ambiguity bites real recipe                                   |

---

## Preserved constraints (lifted from apply-engine-direction)

Do not erode during utilization work:

- **Moat A:** Every write = `query --recipe` + `apply` (or explicit rows/diff), not curated `codemap rename` verbs until triggers fire.
- **Moat B:** Substrate breadth is intentional; utilization work adds **recipes**, not column drops.
- **No severity / verdict engine** on apply rows.
- **No JS execution** at apply time; **no Path A AST apply engine**.
- **No telemetry upload** for reliability loops.
- **Recipe-only policy** does not apply to `--rows` / `apply_rows` (separate trust boundary).

Rejected alternatives with revisit triggers: see [`apply-engine-direction.md` § Rejected](./apply-engine-direction.md#rejected-items-grep-able-revisit-only-on-trigger) until A.8 deletes that file — then grep this heading anchor.

---

## Roadmap linkage (no duplicate backlog prose)

Add to [`roadmap.md`](../roadmap.md) **only after grill** — suggested single backlog row:

- **Substrate & apply utilization** — close doc/test/recipe gaps per [`plans/substrate-apply-utilization.md`](./substrate-apply-utilization.md). Effort: M (docs S + recipes M). Depends: apply-engine [#165] merged.

Until then, this plan holds the queue; do not fork wave-2 items into roadmap twice.

---

## Grill questions (decide before execute)

1. **Utilization north star:** Maximize diff-shape recipe count, or maximize **read→apply chains** on existing audits (evidence chains first)?
2. **`replace-marker-kind`:** Fix SQL to match indexer, or fix indexer to include kind in `content`?
3. **`add-jsdoc-deprecated`:** Flip `auto_fixable: true` after review, or keep `--force` forever?
4. **Synthesis file:** Delete after A.6, or `Status: Partially superseded` stub?
5. **Phase A before C:** Mandatory doc pass before next recipe PR, or parallel?
6. **`rename-app-wide`:** New recipe id vs extend `rename-preview` params (`include_references`)?
7. **MCP fixpoint:** Ship in Phase D or explicitly document “shell loop” as v1 agent pattern?
8. **Capability map:** Promote subagent synthesis to `docs/research/apply-capability-map-2026-06.md` (research) or fold into architecture § Apply?

---

## Success metrics (qualitative — no inventory counts in prose)

After execution:

- A new contributor can answer “how do I apply agent hunks?” from **README + skill** without reading `src/`.
- **Every bundled diff-shape recipe** either applies on minimal fixture in a test or documents why golden is empty.
- At least one **audit recipe → apply recipe** pair is documented end-to-end (e.g. `deprecated-symbols` → `add-jsdoc-deprecated` / future `migrate-deprecated`).
- Synthesis/plan drift grep clean for shipped Steps 8–12.

---

## Cross-references

| Doc                                                                                                  | Role                                         |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [`apply-engine-direction.md`](./apply-engine-direction.md)                                           | Shipped executor steps — close via Phase A.8 |
| [`substrate-extraction.md`](./substrate-extraction.md)                                               | Tiers 1–6 shipped, 7–13 open                 |
| [`codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) | Wave-2 recipe inventory — sync in A.6        |
| [`golden-queries.md`](../golden-queries.md)                                                          | Golden policy for apply row scenarios        |
| [`consumer-surfaces`](../../.agents/rules/consumer-surfaces.md)                                      | Phase A.3–A.4 discipline                     |

---

## Lifecycle

- **While open:** In-flight plan; grill edits happen here.
- **When Phases A+B ship:** Lift § Preserved constraints + transport matrix into `architecture.md`; delete this file or slim to “wave-2 recipe queue only” if C incomplete.
- **When Phases A–C ship:** Delete plan; wave-2 remainder lives in `roadmap.md` Backlog only.
