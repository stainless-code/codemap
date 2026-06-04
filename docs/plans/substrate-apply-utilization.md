# Substrate & apply utilization — gap diagnosis + doc/execution plan

> **Status:** open — **Hygiene slice shipped** (`8d00ba8` on `feat/apply-engine-slices` / [#165](https://github.com/stainless-code/codemap/pull/165)): marker recipe fix, partial Phase A/B, utilization plan added. **Open:** full Phase A (architecture + glossary), Phase B remainder, Phase C wave-2 recipes. Synthesizes 2026-06 apply/substrate exploration (14 parallel codebase audits). **Does not** replace [`apply-engine-direction.md`](./apply-engine-direction.md) (executor shipped) or [`substrate-extraction.md`](./substrate-extraction.md) (tiers 7–13 open).
>
> **Motivator:** Steps 2–12 of the apply-engine landed, but agents and humans still experience codemap as “query + one rename recipe.” This plan answers whether we are using **indexed substrate** and **apply** to their designed capacity, and sequences remaining **documentation** + **recipe/test** work without violating [Moat A](../roadmap.md#moats-load-bearing) / [Moat B](../roadmap.md#moats-load-bearing).

---

## Executive answer (grill this first)

| Layer                     | Using full capability? | One-line why                                                                                                                                                                                                                           |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Substrate (tiers 1–6)** | **Partially**          | Rich tables exist (`references`, `bindings`, `jsx_*`, `import_specifiers`, `jsdoc_tags`, …) but **only a thin slice** is JOIN’d by shipped diff-shape recipes. Tiers **7–13** are intentionally unshipped — not a utilization failure. |
| **Apply executor**        | **Mostly yes**         | Phase-1/2 engine, three CLI input modes, MCP `apply` + `apply_rows`, policy gates, fixpoint loop — **shipped and engine-heavy in tests**.                                                                                              |
| **Apply recipes**         | **No**                 | **4 of 62** bundled SQL recipes emit the diff row contract; **3** are `auto_fixable: true`. The product bottleneck is **recipe surface**, not executor plumbing.                                                                       |
| **Agent/consumer docs**   | **Partially**          | Hygiene: 18-tool count, `apply_rows` in skill/MCP instructions, synthesis shipped blurb, config example. **Still thin:** README lacks dedicated apply subsection; `architecture.md` / `glossary.md` apply sections incomplete.         |
| **Verification**          | **Partially**          | Goldens still query-only (by design). CLI E2E: `rename-preview` + `migrate-import-source` dry-run; allowlist unit tests. **Open:** `--rows`, `--diff-input`, disk apply for non-rename recipes.                                        |

**Conclusion:** We built a **general substrate-shaped apply platform** and indexed a **broad AST→SQLite graph**, but we **under-utilize both** on the user-visible path: recipes don’t read most substrate; maintainer docs still lag code in places. **Next:** wave-2 recipes (Phase C) + finish Phase A.1–A.2 + Phase B — not another apply-engine step.

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

## Utilization model (how to read “full capability”)

### Substrate

**Designed capacity** ([`substrate-extraction.md`](./substrate-extraction.md), [`architecture.md § Schema`](../architecture.md#schema)): tiers 1–6 shipped so recipes can JOIN position-precise calls/imports/exports, bindings graph, JSX, behavioral facts, module flags, `re_export_chains`, etc.

**Actual utilization today (apply-relevant):**

| Substrate cluster                          | Shipped in index?      | Used by shipped apply SQL?                                   | Used by read recipes (feeds apply)?                   |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `symbols` positions + `doc_comment`        | Yes                    | `rename-preview`, `add-jsdoc-deprecated` (positions only)    | `deprecated-symbols`, many audits                     |
| `imports` + `specifiers` + `resolved_path` | Yes                    | `rename-preview` (direct importers), `migrate-import-source` | `find-import-sites`, barrel audits                    |
| `calls` + `provenance`                     | Yes                    | `rename-preview` (`call_rows`, AST only)                     | `find-call-sites`, `call-path`                        |
| `exports` + `re_export_chains`             | Yes                    | `rename-preview` (single-hop `re_export_rows`)               | `barrel-chains`, `find-re-exported-bindings`          |
| `markers`                                  | Yes                    | `replace-marker-kind`                                        | `markers-by-kind`                                     |
| `references` / `bindings` / `scopes`       | Yes                    | **No** apply recipe                                          | `find-symbol-references`, `find-re-exported-bindings` |
| `jsx_elements` / `jsx_attributes`          | Yes                    | **No**                                                       | `find-jsx-usages`                                     |
| `import_specifiers` (child table)          | Yes                    | **No** (stale-imports backlog)                               | —                                                     |
| `jsdoc_tags`                               | Yes (partial tier 4/5) | **No** (`add-jsdoc` is text template, not tag-aware)         | `find-throws-jsdoc`                                   |
| Tiers **7–13**                             | Open                   | N/A                                                          | Future recipes                                        |

**Verdict:** Substrate is **over-built relative to apply recipes** (good for Moat B) but **under-exposed** on the write path. Read path uses more tables; write path uses **four narrow JOIN patterns**.

### Apply

**Designed capacity** ([`apply-engine-direction.md`](./apply-engine-direction.md), [`glossary.md`](../glossary.md)): recipe / rows / diff-input → validate → write; optional fixpoint + commit; `actions[].command`; `auto_fixable` + allowlist; MCP subset.

**Actual utilization:**

| Capability                          | Code     | Docs                                                    | Recipes          | Tests                                                        |
| ----------------------------------- | -------- | ------------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `applyDiffPayload`                  | Shipped  | Partial (`glossary` strong; `architecture` recipe-only) | 4 diff ids       | **Strong** (`apply-engine.test.ts`)                          |
| Recipe apply                        | Shipped  | README rename examples only                             | 4 ids            | **Partial** (`rename-preview` + `migrate-import-source` CLI) |
| `--rows` / `apply_rows`             | Shipped  | Skill/MCP instructions ✓; README apply subsection ✗     | Agent loop       | **None**                                                     |
| `--diff-input`                      | Shipped  | CLI help + skill mention ✓; architecture ✗              | External diffs   | Parser unit only                                             |
| `--until-empty`                     | CLI only | Plan/roadmap                                            | Fixpoint         | **None**                                                     |
| `--commit`                          | CLI only | Plan/roadmap                                            | One-shot git     | **None**                                                     |
| `actions[].command`                 | Shipped  | Skill ✓ (4 recipes); rendered on `--json` query rows    | 4 templates      | Template unit only                                           |
| Policy (allowlist + `auto_fixable`) | Shipped  | Example config ✓; glossary apply expansion ✗            | 3 auto + 1 force | auto_fixable + allowlist unit tests                          |

**Verdict:** Apply **executor ≈ 85% utilized**; **recipe catalog ≈ 6% of SQL files apply-shaped**; **agent docs ≈ 55–60%** after hygiene (was ~40%).

---

## Open work (gap matrix)

| Gap                                                                                      | Type           | Track here            |
| ---------------------------------------------------------------------------------------- | -------------- | --------------------- |
| Wave-2 diff-shape recipes (`organize-imports`, `stale-imports`, `migrate-deprecated`, …) | Implementation | § Phase C             |
| `rename-app-wide` (JOIN `references`/`bindings`)                                         | Implementation | Phase C.5             |
| Barrel-consumer import rename                                                            | Recipe design  | Phase C.5             |
| **`architecture.md` + `glossary.md` apply depth**                                        | Documentation  | § Phase A.1–A.2       |
| README dedicated apply subsection                                                        | Documentation  | § Phase A.3 (partial) |
| Close `apply-engine-direction.md`                                                        | Lifecycle      | § Phase A.8           |
| `testing-coverage.md` apply map; `--rows` / disk apply tests                             | Testing        | § Phase B             |
| MCP `until_empty`                                                                        | Deferred       | § Phase D             |
| Substrate tiers 7–13                                                                     | Separate plan  | substrate-extraction  |

---

## Execution phases

### Phase A — Truth sync (maintainer + consumer)

| Step | Action                                                                                                                            | Status                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| A.1  | **Expand `architecture.md` § Apply wiring** — three input modes, transport matrix, policy, fixpoint envelope, non-goals.          | **Open**                                                     |
| A.2  | **Expand `glossary.md` § `codemap apply`** — rows, diff-input, until-empty, commit, force, allowlist, `passes` / `terminated_by`. | **Open**                                                     |
| A.3  | **README § CLI** — dedicated apply subsection (three modes + recipe catalog); 18 tools ✓ already.                                 | **Partial** — tool count only                                |
| A.4  | **`templates/agent-content`** — apply + apply_rows, command, auto_fixable, force.                                                 | **Partial** — no full discover→dry_run→apply narrative block |
| A.5  | **`rename-preview.md`** coverage vs SQL.                                                                                          | **✓ Shipped**                                                |
| A.6  | **Synthesis** — Steps 2–12 shipped; §4.4/4.5 tables.                                                                              | **✓ Shipped** (delete vs stub: grill Q4 still open)          |
| A.7  | **`codemap.config.example.json`** — `apply.autoApplyRecipes`.                                                                     | **✓ Shipped**                                                |
| A.8  | **Close `apply-engine-direction.md`** — lift rejected + moats here; delete plan file.                                             | **Open**                                                     |

**Phase A exit criteria (remaining):** `architecture.md` + `glossary.md` describe all CLI/MCP apply paths; A.8 complete; README apply subsection optional but recommended.

### Phase B — Verification (maintainer)

| Step | Action                                                                                     | Status                                      |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| B.1  | **`testing-coverage.md`** — apply harness map.                                             | **Open**                                    |
| B.2  | Tracer tests: `--rows` round-trip; disk apply for second recipe; `apply-run` if warranted. | **Partial** — allowlist + migrate dry-run ✓ |
| B.3  | **`replace-marker-kind` golden**                                                           | **✓ Shipped**                               |
| B.4  | **`rename-preview` golden with `re_export`**                                               | **Open**                                    |

**Phase B exit criteria (remaining):** all three CLI input modes tested at least once; B.1 doc map exists.

### Phase C — Recipe utilization (post-doc)

| Priority | Recipe                                           | Status        |
| -------- | ------------------------------------------------ | ------------- |
| C.1      | Fix **`replace-marker-kind`**                    | **✓ Shipped** |
| C.2      | **`organize-imports`**                           | **Open**      |
| C.3      | **`stale-imports`**                              | **Open**      |
| C.4      | **`migrate-deprecated` / `deprecated-usages`**   | **Open**      |
| C.5      | **`rename-app-wide` or barrel import rows**      | **Open**      |
| C.6      | `actions[].command` on audit recipes w/ diff SQL | **Open**      |

**Phase C exit criteria:** ≥2 new diff-shape recipes beyond the original four; `re_export` golden or documented gap removed.

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

## Roadmap linkage

**Shipped:** [`roadmap.md`](../roadmap.md) apply-engine [x] links here for follow-on work. Do not duplicate wave-2 items in roadmap until this plan closes or slim to recipe queue only.

---

## Grill questions (remaining)

| #   | Question                                                  | Resolution so far                         |
| --- | --------------------------------------------------------- | ----------------------------------------- |
| 1   | North star: more diff-shape recipes vs read→apply chains? | **Open**                                  |
| 2   | `replace-marker-kind`: SQL vs indexer?                    | **✓ SQL fix** (drop `content LIKE`)       |
| 3   | `add-jsdoc-deprecated`: flip `auto_fixable`?              | **Open** — still `false` + `--force`      |
| 4   | Synthesis: delete vs superseded stub?                     | **Open**                                  |
| 5   | Phase A before C mandatory?                               | **Open** — hygiene did partial A parallel |
| 6   | `rename-app-wide`: new id vs `rename-preview` params?     | **Open**                                  |
| 7   | MCP fixpoint: ship vs shell loop docs?                    | **Open** — defer Phase D unless demand    |
| 8   | Capability map: research doc vs architecture § Apply?     | **Open**                                  |

---

## Success metrics (qualitative)

| Metric                                                          | Status                                      |
| --------------------------------------------------------------- | ------------------------------------------- |
| Contributor answers “how do I apply hunks?” from README + skill | **Partial** — skill OK; README thin         |
| Every diff-shape recipe non-empty golden or documented          | **✓** — all four have rows                  |
| Audit → apply pair documented end-to-end                        | **Open**                                    |
| No stale “not shipped” / “17 tools” on consumer surfaces        | **✓** for those greps; architecture pending |

---

## Cross-references

| Doc                                                                                                  | Role                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| [`apply-engine-direction.md`](./apply-engine-direction.md)                                           | Executor checklist — close via A.8         |
| [`substrate-extraction.md`](./substrate-extraction.md)                                               | Tiers 1–6 shipped, 7–13 open               |
| [`codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) | Wave-2 inventory — hygiene synced §4.4/4.5 |
| [`golden-queries.md`](../golden-queries.md)                                                          | Golden policy for apply row scenarios      |
| [`consumer-surfaces`](../../.agents/rules/consumer-surfaces.md)                                      | Phase A.3–A.4 discipline                   |

---

## Lifecycle

- **While open:** Queue for Phase A remainder, B remainder, C wave-2.
- **When Phases A+B complete:** Lift transport matrix + moats into `architecture.md`; slim or delete this file if C still open.
- **When Phases A–C complete:** Delete plan; wave-2 remainder in `roadmap.md` Backlog only.
