# Substrate & apply utilization — gap diagnosis + doc/execution plan

> **Status:** open — **Phase A–B + C.3–C.5 shipped** on `feat/apply-engine-slices` / [#165](https://github.com/stainless-code/codemap/pull/165). **Open:** C.6, multi-specifier stale-imports, Phase D. `organize-imports` rejected (formatter domain). Substrate tiers 7–13: [`substrate-extraction.md`](./substrate-extraction.md).

---

## Executive answer (grill this first)

| Layer                     | Using full capability? | One-line why                                                                                                                                                                                                                           |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Substrate (tiers 1–6)** | **Partially**          | Rich tables exist (`references`, `bindings`, `jsx_*`, `import_specifiers`, `jsdoc_tags`, …) but **only a thin slice** is JOIN'd by shipped diff-shape recipes. Tiers **7–13** are intentionally unshipped — not a utilization failure. |
| **Apply executor**        | **Mostly yes**         | Phase-1/2 engine, three CLI input modes, MCP `apply` + `apply_rows`, policy gates, fixpoint loop — **shipped and engine-heavy in tests**.                                                                                              |
| **Apply recipes**         | **Mostly yes**         | **7 of 62** diff-shape recipes; `deprecated-symbols` → `migrate-deprecated` / `deprecated-usages`. Remaining: multi-specifier import edits, C.6.                                                                                       |
| **Agent/consumer docs**   | **Mostly yes**         | Architecture + glossary + README apply subsection + skill/MCP apply workflow. Wave-2 recipe catalog still thin until Phase C.                                                                                                          |
| **Verification**          | **Mostly yes**         | CLI E2E: three input modes (recipe, `--rows`, recipes on disk); `rename-preview-product-card` golden (barrel + re-export). **Open:** `--diff-input` CLI e2e.                                                                           |

**Conclusion:** Seven diff-shape recipes shipped including deprecated audit→apply pair. **Next:** C.6 / multi-specifier stale-imports; close plan when exit criteria met.

---

## Hygiene slice shipped (2026-06, `8d00ba8`)

| #   | Item                                                                                         |
| --- | -------------------------------------------------------------------------------------------- |
| 1   | `replace-marker-kind` SQL — drop `content LIKE`; golden row for `src/notes.md`               |
| 2   | `rename-preview.md` — calls, re-exports, barrel-consumer gap                                 |
| 3   | MCP **18 tools** — README, glossary, bootstrap, `cmd-mcp` (+ `apply_rows` in help)           |
| 4   | Synthesis — apply-engine steps marked shipped; §4.4/4.5 + agent gap table                    |
| 5   | `codemap.config.example.json` — `apply.autoApplyRecipes`                                     |
| 6   | `apply-policy.test.ts` — renamed auto_fixable test                                           |
| 7   | `cmd-apply.test.ts` — `migrate-import-source` dry-run E2E                                    |
| 8   | `assertApplyAllowlist` unit tests                                                            |
| 9   | `mcp-instructions.md` + `10-recipes-context.md` — `apply_rows`, `force`, `command`, 18 tools |
| 10  | `roadmap.md` — link to this plan                                                             |

---

## Phase A docs shipped (2026-06)

| Step | Action                                                                                             | Status |
| ---- | -------------------------------------------------------------------------------------------------- | ------ |
| A.1  | **`architecture.md` § Apply** — input modes, transport matrix, policy, fixpoint, non-goals anchor. | **✓**  |
| A.2  | **`glossary.md`** — `codemap apply`, `apply_rows`, flags, allowlist, `passes` / `terminated_by`.   | **✓**  |
| A.3  | **README § CLI** — apply subsection (three modes + bundled recipe ids + MCP tools).                | **✓**  |
| A.4  | **`templates/agent-content`** — discover→dry_run→apply workflow in skill + MCP chains.             | **✓**  |
| A.5  | **`rename-preview.md`** coverage vs SQL.                                                           | **✓**  |
| A.6  | **Synthesis** — Steps 2–12 shipped; §4.4/4.5 tables.                                               | **✓**  |
| A.7  | **`codemap.config.example.json`** — `apply.autoApplyRecipes`.                                      | **✓**  |
| A.8  | **Close `apply-engine-direction.md`** — rejected table + moats lifted below; plan deleted.         | **✓**  |

Canonical apply homes: [`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy), [`glossary.md § codemap apply`](../glossary.md#codemap-apply--apply-tool).

---

## Utilization model (how to read “full capability”)

### Substrate

**Designed capacity** ([`substrate-extraction.md`](./substrate-extraction.md), [`architecture.md § Schema`](../architecture.md#schema)): tiers 1–6 shipped so recipes can JOIN position-precise calls/imports/exports, bindings graph, JSX, behavioral facts, module flags, `re_export_chains`, etc.

**Actual utilization today (apply-relevant):**

| Substrate cluster                          | Shipped in index?      | Used by shipped apply SQL?                                                | Used by read recipes (feeds apply)?                   |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `symbols` positions + `doc_comment`        | Yes                    | `rename-preview`, `add-jsdoc-deprecated` (positions only)                 | `deprecated-symbols`, many audits                     |
| `imports` + `specifiers` + `resolved_path` | Yes                    | `rename-preview` (direct + `barrel_import_rows`), `migrate-import-source` | `find-import-sites`, barrel audits                    |
| `calls` + `provenance`                     | Yes                    | `rename-preview` (`call_rows`, AST only)                                  | `find-call-sites`, `call-path`                        |
| `exports` + `re_export_chains`             | Yes                    | `rename-preview` (single-hop `re_export_rows`)                            | `barrel-chains`, `find-re-exported-bindings`          |
| `markers`                                  | Yes                    | `replace-marker-kind`                                                     | `markers-by-kind`                                     |
| `references` / `bindings` / `scopes`       | Yes                    | `rename-preview` (`reference_rows`; non-import/call/definition)           | `find-symbol-references`, `find-re-exported-bindings` |
| `jsx_elements` / `jsx_attributes`          | Yes                    | **No**                                                                    | `find-jsx-usages`                                     |
| `import_specifiers` (child table)          | Yes                    | **`stale-imports`** (sole-specifier lines)                                | —                                                     |
| `jsdoc_tags`                               | Yes (partial tier 4/5) | **No** (`add-jsdoc` is text template, not tag-aware)                      | `find-throws-jsdoc`                                   |
| Tiers **7–13**                             | Open                   | N/A                                                                       | Future recipes                                        |

**Verdict:** Substrate is **over-built relative to apply recipes** (good for Moat B) but **under-exposed** on the write path.

### Apply

**Designed capacity** ([`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy), [`glossary.md`](../glossary.md)): recipe / rows / diff-input → validate → write; optional fixpoint + commit; `actions[].command`; `auto_fixable` + allowlist; MCP subset.

**Actual utilization:**

| Capability                          | Code     | Docs                        | Recipes          | Tests                                                             |
| ----------------------------------- | -------- | --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `applyDiffPayload`                  | Shipped  | Architecture + glossary ✓   | 4 diff ids       | **Strong** (`apply-engine.test.ts`)                               |
| Recipe apply                        | Shipped  | README + skill ✓            | 4 ids            | **Strong** (rename + migrate dry-run; `replace-marker-kind` disk) |
| `--rows` / `apply_rows`             | Shipped  | Glossary + skill ✓          | Agent loop       | **`cmd-apply.test.ts` `--rows` file**                             |
| `--diff-input`                      | Shipped  | Architecture + glossary ✓   | External diffs   | Parser unit only                                                  |
| `--until-empty`                     | CLI only | Architecture + glossary ✓   | Fixpoint         | **None**                                                          |
| `--commit`                          | CLI only | Architecture + glossary ✓   | One-shot git     | **None**                                                          |
| `actions[].command`                 | Shipped  | Skill ✓                     | 4 templates      | Template unit only                                                |
| Policy (allowlist + `auto_fixable`) | Shipped  | Example config + glossary ✓ | 3 auto + 1 force | auto_fixable + allowlist unit tests                               |

**Verdict:** Apply **executor ≈ 85% utilized**; **recipe catalog ≈ 6% of SQL files apply-shaped**; **agent docs ≈ 75%** after Phase A.

---

## Open work (gap matrix)

| Gap                                                                   | Type           | Track here           |
| --------------------------------------------------------------------- | -------------- | -------------------- |
| Multi-specifier `stale-imports`; `actions[].command` on audit recipes | Implementation | § Phase C            |
| `--diff-input` CLI e2e                                                | Testing        | § Phase B (optional) |
| MCP `until_empty` / `--commit`                                        | Deferred       | § Phase D            |
| Substrate tiers 7–13                                                  | Separate plan  | substrate-extraction |

---

## Execution phases

### Phase B — Verification (maintainer)

| Step | Action                                                                                     | Status                                                           |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| B.1  | **`testing-coverage.md`** — apply harness map.                                             | **✓ Shipped**                                                    |
| B.2  | Tracer tests: `--rows` round-trip; disk apply for second recipe; `apply-run` if warranted. | **✓ Shipped** — `--rows` file + `replace-marker-kind` disk apply |
| B.3  | **`replace-marker-kind` golden**                                                           | **✓ Shipped**                                                    |
| B.4  | **`rename-preview` golden with `re_export`**                                               | **✓ Shipped** — `rename-preview-product-card` scenario           |

**Phase B exit criteria:** **✓** — recipe + `--rows` + doc map; `--diff-input` covered by unit tests only.

### Phase C — Recipe utilization (post-doc)

| Priority | Recipe                                           | Status                                                                      |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| C.1      | Fix **`replace-marker-kind`**                    | **✓ Shipped**                                                               |
| C.2      | **`organize-imports`**                           | **Rejected** — formatter/ESLint domain; see § Rejected                      |
| C.3      | **`stale-imports`**                              | **✓ Shipped** — sole-specifier line delete (v1)                             |
| C.4      | **`migrate-deprecated` / `deprecated-usages`**   | **✓ Shipped**                                                               |
| C.5      | **`rename-app-wide` or barrel import rows**      | **✓ Shipped** — `barrel_import_rows` + `reference_rows` on `rename-preview` |
| C.6      | `actions[].command` on audit recipes w/ diff SQL | **Open**                                                                    |

**Phase C exit criteria (partial):** ≥2 new ids beyond original four (`stale-imports`, `migrate-deprecated`, `deprecated-usages`) ✓; C.6 open.

### Phase D — Optional transport parity (trigger-gated)

| Item                                | Trigger                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| MCP `until_empty`                   | ≥2 agent-host requests or internal dogfood fixpoint loops without shell |
| MCP/HTTP `--diff-input`             | Demand after `apply_rows` documented                                    |
| `ambiguity_count` on diff-json rows | Same-line ambiguity bites real recipe                                   |

---

## Preserved constraints (apply path)

Do not erode during utilization work:

- **Moat A:** Every write = `query --recipe` + `apply` (or explicit rows/diff), not curated `codemap rename` verbs until triggers fire.
- **Moat B:** Substrate breadth is intentional; utilization work adds **recipes**, not column drops.
- **No severity / verdict engine** on apply rows.
- **No JS execution** at apply time; **no Path A AST apply engine**.
- **No telemetry upload** for reliability loops.
- **Recipe-only policy** does not apply to `--rows` / `apply_rows` (separate trust boundary).

The "no fix engine" floor was about **product class** (no ESLint-style verdict engine), not forbidding a **substrate-shaped** apply executor.

---

## Rejected items (grep-able; revisit only on trigger)

| Item                                              | Why rejected                                           | Revisit when                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Curated CLI write verbs (`codemap rename`, …)     | Moat A — premature verb sprawl                         | ≥3 diff-shape recipes + clear agent-host demand beyond `actions[].command`                                   |
| Parallel AST apply engine (Path A)                | Competes with ts-morph/jscodeshift; maintenance burden | ≥2 external teams hit substring wall + concrete AST-shape demand                                             |
| Trust tiers (`safe`/`review`/`risky`)             | Taxonomy debt; `auto_fixable` + allowlist suffice      | Allowlist insufficient + ≥2 consumers ship trust filters in CI                                               |
| Per-row confidence scores                         | No consensus on computation                            | Recipe needs per-site ranking when `before_pattern` is ambiguous                                             |
| Verifier as product surface (typecheck/lint gate) | Consumer CI owns orchestration                         | Consumer plan with concrete examples                                                                         |
| Reliability loop telemetry                        | No upload floor                                        | Self-hosted observability request                                                                            |
| `--branch` / `--output-patch` flags               | `--commit` priority                                    | `--commit` insufficient in practice                                                                          |
| Multi-line kind-tagged row contract               | After single-line path stable                          | Multi-line edits required and workarounds fail                                                               |
| Cross-file moves in one apply                     | Higher risk                                            | Alternative two-step ops insufficient                                                                        |
| Cross-file atomic apply (50+ files)               | Per-file atomicity sufficient today                    | Real 50+ file apply + partial failure leak                                                                   |
| **`organize-imports`** (sort/group import lines)  | Prettier / Biome / ESLint `import/order` territory     | Index-driven import order + substring apply proves insufficient vs `actions[].command` pointing at formatter |

Full trigger wording: [`research/codemap-richer-index-synthesis-2026-05.md` § 7](../research/codemap-richer-index-synthesis-2026-05.md#7-rejected-items-with-trigger-conditions).

---

## Roadmap linkage

**Shipped:** [`roadmap.md`](../roadmap.md) apply-engine [x] links here for wave-2 + tests. Do not duplicate Phase C items in roadmap until this plan closes or slim to recipe queue only.

---

## Grill questions (remaining)

| #   | Question                                                  | Resolution so far                         |
| --- | --------------------------------------------------------- | ----------------------------------------- |
| 1   | North star: more diff-shape recipes vs read→apply chains? | **Open**                                  |
| 2   | `replace-marker-kind`: SQL vs indexer?                    | **✓ SQL fix** (drop `content LIKE`)       |
| 3   | `add-jsdoc-deprecated`: flip `auto_fixable`?              | **Open** — still `false` + `--force`      |
| 4   | Synthesis: delete vs superseded stub?                     | **Open**                                  |
| 5   | Phase A before C mandatory?                               | **✓** — Phase A closed                    |
| 6   | `rename-app-wide`: new id vs `rename-preview` params?     | **Open**                                  |
| 7   | MCP fixpoint: ship vs shell loop docs?                    | **Open** — defer Phase D unless demand    |
| 8   | Capability map: research doc vs architecture § Apply?     | **✓** — architecture § Apply is canonical |

---

## Success metrics (qualitative)

| Metric                                                          | Status                          |
| --------------------------------------------------------------- | ------------------------------- |
| Contributor answers “how do I apply hunks?” from README + skill | **✓**                           |
| Every diff-shape recipe non-empty golden or documented          | **✓** — all four have rows      |
| Audit → apply pair documented end-to-end                        | **✓** — skill + MCP apply chain |
| No stale “not shipped” / “17 tools” on consumer surfaces        | **✓**                           |

---

## Cross-references

| Doc                                                                                                  | Role                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy)              | Transport matrix + policy (canonical)      |
| [`substrate-extraction.md`](./substrate-extraction.md)                                               | Tiers 1–6 shipped, 7–13 open               |
| [`codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) | Wave-2 inventory — hygiene synced §4.4/4.5 |
| [`golden-queries.md`](../golden-queries.md)                                                          | Golden policy for apply row scenarios      |
| [`consumer-surfaces`](../../.agents/rules/consumer-surfaces.md)                                      | Agent-content discipline                   |

---

## Lifecycle

- **While open:** Queue for Phase B remainder + Phase C wave-2.
- **When Phases B+C complete:** Delete plan; wave-2 remainder in `roadmap.md` Backlog only.
