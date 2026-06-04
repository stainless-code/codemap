# Substrate & apply utilization — gap diagnosis + doc/execution plan

> **Status:** **ready to close** — Phases A–D + **C.6** shipped. `organize-imports` rejected. Substrate tiers 7–13: [`substrate-extraction.md`](./substrate-extraction.md).

---

## Executive answer (grill this first)

| Layer                     | Using full capability? | One-line why                                                                                                                                                                                                                          |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Substrate (tiers 1–6)** | **Partially**          | Tiers 1–6 shipped; **eight** diff-shape recipes JOIN a meaningful slice (`references`, `imports`, `calls`, `jsx_*`, `import_specifiers`, `markers`, `re_export_chains`). Tiers **7–13** unshipped — separate plan, not apply failure. |
| **Apply executor**        | **Mostly yes**         | Phase-1/2 engine, three CLI input modes, MCP `apply` + `apply_rows`, policy gates, fixpoint loop — **shipped and engine-heavy in tests**.                                                                                             |
| **Apply recipes**         | **Yes**                | **8 diff-shape ids** + read→apply `command` hints on paired audit recipes (C.6).                                                                                                                                                      |
| **Agent/consumer docs**   | **Mostly yes**         | Architecture § Apply, glossary, README, skill/MCP chains, `testing-coverage.md` apply table.                                                                                                                                          |
| **Verification**          | **Yes**                | `cmd-apply.test.ts`: rename, `--rows`, `--diff-input`, `--until-empty`, `--commit`, marker/deprecated/stale/JSX apply; 10+ apply golden scenarios.                                                                                    |

**Conclusion:** Wave-2 complete — **8 diff-shape recipes**, C.6 read→apply commands, JSX + multi-specifier imports. **Delete this plan** when PR merges; keep catalog in `architecture.md` § Apply.

---

## Bundled diff-shape catalog (2026-06)

Eight recipes emit `{file_path, line_start, before_pattern, after_pattern}` (plus `location_kind`, `chain_depth`). Inspect: `codemap query --recipe <id> --format diff-json`.

| Recipe id               | `auto_fixable` | Primary substrate                                                                 | Read-side pair / notes                                      |
| ----------------------- | -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `rename-preview`        | true           | `symbols`, `imports`, `calls`, `bindings`, `re_export_chains`, **`jsx_elements`** | `find-symbol-references`; member JSX via `jsx_element_rows` |
| `migrate-import-source` | true           | `imports.source`                                                                  | `find-import-sites`                                         |
| `replace-marker-kind`   | true           | `markers`                                                                         | `markers-by-kind`                                           |
| `stale-imports`         | false          | `import_specifiers` × `"references"`                                              | —                                                           |
| `migrate-deprecated`    | false          | `calls`, `imports`                                                                | `deprecated-symbols`                                        |
| `deprecated-usages`     | false          | `symbols.doc_comment`                                                             | `deprecated-symbols`                                        |
| `migrate-jsx-prop`      | false          | `jsx_attributes` × `jsx_elements`                                                 | `find-jsx-usages`                                           |
| `add-jsdoc-deprecated`  | false          | `symbols` (insert line)                                                           | `deprecated-symbols`                                        |

**Rejected (wave-2):** `organize-imports` — formatter domain (§ Rejected).

**Recipe SQL count:** 8 / 66 bundled `.sql` files ≈ **12%** apply-shaped (Moat B breadth >> apply count by design).

---

## Hygiene slice shipped (2026-06, `8d00ba8`)

| #   | Item                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `replace-marker-kind` SQL — drop `content LIKE`; golden row for `src/notes.md`                                   |
| 2   | `rename-preview.md` — calls, re-exports, barrel-consumer gap                                                     |
| 3   | MCP **19 tools** — README, glossary, bootstrap, `cmd-mcp` (+ `apply_rows`, `apply_diff_input`)                   |
| 4   | Synthesis — apply-engine steps marked shipped; §4.4/4.5 + agent gap table                                        |
| 5   | `codemap.config.example.json` — `apply.autoApplyRecipes`                                                         |
| 6   | `apply-policy.test.ts` — renamed auto_fixable test                                                               |
| 7   | `cmd-apply.test.ts` — `migrate-import-source` dry-run E2E                                                        |
| 8   | `assertApplyAllowlist` unit tests                                                                                |
| 9   | `mcp-instructions.md` + `10-recipes-context.md` — `apply_rows`, `apply_diff_input`, `force`, `command`, 19 tools |
| 10  | `roadmap.md` — link to this plan                                                                                 |

### Wave-2 recipe slice (post-hygiene)

| Item                                                                                                   | Shipped |
| ------------------------------------------------------------------------------------------------------ | ------- |
| `stale-imports` sole + multi-specifier comma strip                                                     | ✓       |
| `migrate-deprecated` / `deprecated-usages`                                                             | ✓       |
| `rename-preview` `barrel_import_rows` + `reference_rows`                                               | ✓       |
| `rename-preview` `jsx_element_rows` + `jsx_closing_rows`; `migrate-jsx-prop`                           | ✓       |
| Goldens: `stale-imports-multi-specifier`, `rename-preview-jsx-member`, `migrate-jsx-prop-product-card` | ✓       |

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

| Substrate cluster                          | Shipped in index?      | Used by shipped apply SQL?                                        | Used by read recipes (feeds apply)?                   |
| ------------------------------------------ | ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| `symbols` positions + `doc_comment`        | Yes                    | `rename-preview`, `add-jsdoc-deprecated`, `deprecated-usages`     | `deprecated-symbols`, many audits                     |
| `imports` + `specifiers` + `resolved_path` | Yes                    | `rename-preview`, `migrate-import-source`, `migrate-deprecated`   | `find-import-sites`, barrel audits                    |
| `calls` + `provenance`                     | Yes                    | `rename-preview`, `migrate-deprecated`                            | `find-call-sites`, `call-path`                        |
| `exports` + `re_export_chains`             | Yes                    | `rename-preview` (`re_export_rows`, `barrel_import_rows`)         | `barrel-chains`, `find-re-exported-bindings`          |
| `markers`                                  | Yes                    | `replace-marker-kind`                                             | `markers-by-kind`                                     |
| `references` / `bindings` / `scopes`       | Yes                    | `rename-preview` (`reference_rows`)                               | `find-symbol-references`, `find-re-exported-bindings` |
| `jsx_elements` / `jsx_attributes`          | Yes                    | `rename-preview` (member/closing gaps), `migrate-jsx-prop`        | `find-jsx-usages`                                     |
| `import_specifiers` (child table)          | Yes                    | `stale-imports` (sole line + multi-specifier strip)               | —                                                     |
| `jsdoc_tags`                               | Yes (partial tier 4/5) | **No** (`add-jsdoc-deprecated` is line insert, not tag-row aware) | `find-throws-jsdoc`                                   |
| Tiers **7–13**                             | Open                   | N/A                                                               | Future recipes                                        |

**Verdict:** Substrate still **wider than apply** (Moat B); tiers 1–6 **materially utilized** on the write path.

### Apply

**Designed capacity** ([`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy), [`glossary.md`](../glossary.md)): recipe / rows / diff-input → validate → write; optional fixpoint + commit; `actions[].command`; `auto_fixable` + allowlist; MCP subset.

**Actual utilization:**

| Capability                          | Code    | Docs                        | Recipes                        | Tests                                                                      |
| ----------------------------------- | ------- | --------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `applyDiffPayload`                  | Shipped | Architecture + glossary ✓   | **8** diff-shape ids           | **Strong** (`apply-engine.test.ts`)                                        |
| Recipe apply                        | Shipped | README + skill ✓            | **8** ids                      | **Strong** (`cmd-apply.test.ts` — rename, markers, deprecated, stale, JSX) |
| `--rows` / `apply_rows`             | Shipped | Glossary + skill ✓          | Agent loop                     | **`cmd-apply.test.ts` `--rows` file**                                      |
| `--diff-input` / `apply_diff_input` | Shipped | Architecture + glossary ✓   | External diffs                 | Unit + **`cmd-apply.test.ts` `--diff-input`**                              |
| `--until-empty` / MCP `until_empty` | Shipped | Architecture + glossary ✓   | Fixpoint on recipe `apply`     | **`cmd-apply.test.ts` `--until-empty`**                                    |
| `--commit` / `commit_message`       | Shipped | Architecture + glossary ✓   | Git after clean apply          | **`cmd-apply.test.ts` `--commit`**; MCP on `apply` / `apply_diff_input`    |
| `actions[].command`                 | Shipped | Skill ✓                     | **8** apply + **6** read pairs | Template unit + `cmd-query.test.ts` C.6 cases                              |
| Policy (allowlist + `auto_fixable`) | Shipped | Example config + glossary ✓ | **3** auto + **5** force       | `apply-policy.test.ts`, allowlist tests                                    |

**Verdict:** Apply **executor ≈ 85% utilized**; **recipe catalog** wave-2 + C.6 complete; **agent docs ≈ 85%**.

---

## Open work (gap matrix)

| Gap                                | Type          | Track here                                                                                                     |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| ~~`--diff-input` CLI e2e~~         | Testing       | **✓ Shipped** (`cmd-apply.test.ts`)                                                                            |
| ~~MCP `until_empty` / `--commit`~~ | Transport     | **✓ Shipped** — MCP/HTTP `apply` (`until_empty`, `commit_message`); `apply_diff_input` (`commit_message` only) |
| Substrate tiers 7–13               | Separate plan | substrate-extraction                                                                                           |

---

## Execution phases

### Phase B — Verification (maintainer)

| Step | Action                                                                                     | Status                                                           |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| B.1  | **`testing-coverage.md`** — apply harness map.                                             | **✓ Shipped**                                                    |
| B.2  | Tracer tests: `--rows` round-trip; disk apply for second recipe; `apply-run` if warranted. | **✓ Shipped** — `--rows` file + `replace-marker-kind` disk apply |
| B.3  | **`replace-marker-kind` golden**                                                           | **✓ Shipped**                                                    |
| B.4  | **`rename-preview` golden with `re_export`**                                               | **✓ Shipped** — `rename-preview-product-card` scenario           |

**Phase B exit criteria:** **✓** — recipe + `--rows` + doc map; `--diff-input` unit + CLI e2e.

### Phase C — Recipe utilization (post-doc)

| Priority | Recipe                                          | Status                                                                      |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| C.1      | Fix **`replace-marker-kind`**                   | **✓ Shipped**                                                               |
| C.2      | **`organize-imports`**                          | **Rejected** — formatter/ESLint domain; see § Rejected                      |
| C.3      | **`stale-imports`**                             | **✓ Shipped** — sole line delete + multi-specifier comma strip              |
| C.4      | **`migrate-deprecated` / `deprecated-usages`**  | **✓ Shipped**                                                               |
| C.5      | **`rename-app-wide` or barrel import rows**     | **✓ Shipped** — `barrel_import_rows` + `reference_rows` on `rename-preview` |
| C.6      | `actions[].command` on audit→apply read recipes | **✓ Shipped** — `deprecated-symbols`, symbol/JSX/import/marker pairs        |
| C.7      | **JSX rename/usages** (`jsx_*` substrate)       | **✓ Shipped** — `rename-preview` jsx rows + `migrate-jsx-prop`              |

**Phase C exit criteria:** **✓** — wave-2 ids + JSX + multi-specifier + C.6 read→apply commands.

### Phase D — Optional transport parity

| Item                                 | Status                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| MCP `until_empty` + `commit_message` | **✓ Shipped** — `apply` tool args; CLI twin unchanged     |
| MCP/HTTP `apply_diff_input`          | **✓ Shipped** — `diff_text` (+ optional `commit_message`) |
| `ambiguity_count` on diff-json hunks | **✓ Shipped** — per-hunk field + warning when `> 0`       |

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

| Item                                              | Why rejected                                           | Revisit when                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Curated CLI write verbs (`codemap rename`, …)     | Moat A — premature verb sprawl                         | ≥3 diff-shape recipes + clear agent-host demand beyond `actions[].command` (**trigger met** — revisit in plan PR) |
| Parallel AST apply engine (Path A)                | Competes with ts-morph/jscodeshift; maintenance burden | ≥2 external teams hit substring wall + concrete AST-shape demand                                                  |
| Trust tiers (`safe`/`review`/`risky`)             | Taxonomy debt; `auto_fixable` + allowlist suffice      | Allowlist insufficient + ≥2 consumers ship trust filters in CI                                                    |
| Per-row confidence scores                         | No consensus on computation                            | Recipe needs per-site ranking when `before_pattern` is ambiguous                                                  |
| Verifier as product surface (typecheck/lint gate) | Consumer CI owns orchestration                         | Consumer plan with concrete examples                                                                              |
| Reliability loop telemetry                        | No upload floor                                        | Self-hosted observability request                                                                                 |
| `--branch` / `--output-patch` flags               | `--commit` priority                                    | `--commit` insufficient in practice                                                                               |
| Multi-line kind-tagged row contract               | After single-line path stable                          | Multi-line edits required and workarounds fail                                                                    |
| Cross-file moves in one apply                     | Higher risk                                            | Alternative two-step ops insufficient                                                                             |
| Cross-file atomic apply (50+ files)               | Per-file atomicity sufficient today                    | Real 50+ file apply + partial failure leak                                                                        |
| **`organize-imports`** (sort/group import lines)  | Prettier / Biome / ESLint `import/order` territory     | Index-driven import order + substring apply proves insufficient vs `actions[].command` pointing at formatter      |

Full trigger wording: [`research/codemap-richer-index-synthesis-2026-05.md` § 7](../research/codemap-richer-index-synthesis-2026-05.md#7-rejected-items-with-trigger-conditions).

---

## Roadmap linkage

**Shipped:** [`roadmap.md`](../roadmap.md) apply-engine [x]. **This plan:** delete on merge; do not duplicate the eight recipe ids in roadmap.

---

## Grill questions (remaining)

| #   | Question                                                  | Resolution so far                         |
| --- | --------------------------------------------------------- | ----------------------------------------- |
| 1   | North star: more diff-shape recipes vs read→apply chains? | **Open**                                  |
| 2   | `replace-marker-kind`: SQL vs indexer?                    | **✓ SQL fix** (drop `content LIKE`)       |
| 3   | `add-jsdoc-deprecated`: flip `auto_fixable`?              | **Open** — still `false` + `--force`      |
| 4   | Synthesis: delete vs superseded stub?                     | **Open**                                  |
| 5   | Phase A before C mandatory?                               | **✓** — Phase A closed                    |
| 6   | `rename-app-wide`: new id vs `rename-preview` params?     | **✓** — extend `rename-preview` CTEs      |
| 7   | MCP fixpoint: ship vs shell loop docs?                    | **✓** — `apply.until_empty` on MCP/HTTP   |
| 8   | Capability map: research doc vs architecture § Apply?     | **✓** — architecture § Apply is canonical |

---

## Success metrics (qualitative)

| Metric                                                          | Status                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Contributor answers “how do I apply hunks?” from README + skill | **✓**                                                                                 |
| Every diff-shape recipe non-empty golden or documented          | **✓** — **8/8** (see catalog); map in [`testing-coverage.md`](../testing-coverage.md) |
| Audit → apply pair documented end-to-end                        | **✓** — deprecated + JSX pairs in architecture + skill                                |
| No stale “not shipped” / wrong tool count on consumer surfaces  | **✓** (19 MCP tools incl. `apply_diff_input`)                                         |

---

## Cross-references

| Doc                                                                                                  | Role                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy)              | Transport matrix + policy (canonical)    |
| [`testing-coverage.md`](../testing-coverage.md)                                                      | Apply golden + `cmd-apply.test.ts` map   |
| [`substrate-extraction.md`](./substrate-extraction.md)                                               | Tiers 1–6 shipped, 7–13 open             |
| [`codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) | Research archive — open work points here |
| [`golden-queries.md`](../golden-queries.md)                                                          | Golden policy for apply row scenarios    |
| [`consumer-surfaces`](../../.agents/rules/consumer-surfaces.md)                                      | Agent-content discipline                 |

---

## Lifecycle

- **While open:** none — optional/deferred items shipped; delete on merge.
- **On merge:** Delete this plan; keep catalog in `architecture.md` § Apply + `testing-coverage.md`.

### C.6 read→apply pairs (shipped)

| Read recipe               | Apply command action(s)                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `deprecated-symbols`      | `migrate-deprecated`, `deprecated-usages`, `add-jsdoc-deprecated` |
| `find-symbol-references`  | `rename-preview` (`old={{name}}`)                                 |
| `find-symbol-definitions` | `rename-preview` (`old={{name}}`)                                 |
| `find-jsx-usages`         | `rename-preview`, `migrate-jsx-prop`                              |
| `find-import-sites`       | `migrate-import-source` (`OLD_SOURCE` / `NEW_SOURCE` sentinels)   |
| `markers-by-kind`         | `replace-marker-kind`                                             |
