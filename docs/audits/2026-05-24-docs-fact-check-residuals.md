# Docs fact-check residuals — 2026-05-24

**Status:** Open — code items R.1–R.3 remain; doc-only R.4–R.9 fixed in follow-up commits on `main`.

**Scope:** ~129 markdown files under `docs/`, `.agents/`, `templates/`, root, and `.github/`. Parent verification on `main` through `0f7e6fc`.

**Method:** Five parallel fact-check passes against `src/`, `package.json`, CI workflows, and `templates/recipes/`; manual diff review for information loss.

**Shipped in audit commits:** `e6ab158`, `3c65a65`, `0f7e6fc` — glob/batchInsert corrections, `--base` git-archive wording, MCP vs HTTP resource split, plan status headers, agent-content path fixes, recipe example SQL, rule frontmatter, synthesis Step 1 closure.

This audit follows [docs/README.md Rule 6](../README.md) and [docs/README.md Rule 7](../README.md).

---

## TL;DR

The audit corrected stale/wrong prose without dropping load-bearing design. **Doc-only nits (R.4–R.9) are fixed.** **Three code/doc drift items (R.1–R.3)** remain — none block releases.

---

## Residual findings

### Code fixes (docs partially or fully updated)

| ID      | Finding                                                                                                                                                                                                                             | Evidence                                                                                                              | Suggested fix                                                                                                                                    | Effort             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| **R.1** | **Project recipes ignore custom `--state-dir`.** Docs now say `<projectRoot>/.codemap/recipes/`; loader hardcodes that path.                                                                                                        | `resolveProjectRecipesDir()` in `src/application/query-recipes.ts` — `join(projectRoot, ".codemap", "recipes")` only. | Honor `resolveStateDir()` when resolving project recipe dir, or document permanently that recipes are `.codemap`-scoped only.                    | S                  |
| **R.2** | **`function_params.owner_kind` never varies.** Recipe doc updated; extractor always passes `"function"`.                                                                                                                            | `pushParams()` default in `src/extractors/params.ts`; all call sites omit `ownerKind`.                                | Populate distinct values (`method`, `arrow`, `constructor`, …) at extraction sites, then restore filter docs on `find-by-param-type`.            | M                  |
| **R.3** | **MCP stdio does not register `codemap://files/{path}` / `codemap://symbols/{name}`.** README and glossary correctly scope these to HTTP `GET /resources/{uri}`; `readResource()` supports them but `registerResources()` does not. | `src/application/mcp-server.ts` vs `src/application/resource-handlers.ts`.                                            | Either register as MCP resource templates (parity with HTTP) or keep HTTP-only and ensure agent-content skill states the split (done in README). | S (if registering) |

### Doc-only — fixed

| ID      | Finding                                    | Fix                                                                      |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| **R.4** | Example timing tables will drift           | `docs/benchmark.md` § Results — snapshot / regenerate callout            |
| **R.5** | "Main tables" copy ambiguous               | `templates/recipes/index-summary.md` — names five tables + points at SQL |
| **R.6** | Relative recipe link in MCP context        | `templates/recipes/unused-type-members.md` — recipe id prose only        |
| **R.7** | README env block omitted state-dir / watch | `README.md` Environment / flags — `CODEMAP_STATE_DIR`, `CODEMAP_WATCH`   |
| **R.8** | Substrate plan ship dates mixed            | `docs/plans/substrate-extraction.md` header — wave vs per-PR date note   |
| **R.9** | Research note § numbering gap              | `docs/research/non-goals-reassessment-2026-05.md` — §4/§6 lifted note    |

### Already tracked elsewhere (no new work)

| ID       | Item                                                      | Canonical home                                                                                                                |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **R.10** | GitHub Marketplace Slice 5 (tags, `MARKETPLACE.md`)       | [`roadmap.md` Backlog](../roadmap.md#backlog) · [`plans/github-marketplace-action.md`](../plans/github-marketplace-action.md) |
| **R.11** | C.9 `files.is_entry`, plugin loader, reachability recipes | [`plans/c9-plugin-layer.md`](../plans/c9-plugin-layer.md)                                                                     |
| **R.12** | Apply-engine synthesis Steps 2–12                         | [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) §6              |

---

## Closing criteria

Delete this file when **R.1–R.3** are resolved or explicitly rejected with a one-line decision in `roadmap.md`. Index closure in [`roadmap.md` § Closed audits (pointers)](../roadmap.md#closed-audits-pointers).

Recover the full May 2026 audit agent reports via conversation / commit diffs at `f25f8a6..0f7e6fc` if needed.
