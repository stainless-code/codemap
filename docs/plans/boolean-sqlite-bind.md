# Recipe boolean → SQLite bind — plan

> **Status:** open · **Priority:** P0 (shipped recipes broken on Node / better-sqlite3) · **Effort:** S (~1 tracer slice)
>
> **Motivator:** Bundled recipes with `type: boolean` params fail at bind time with `SQLite3 can only bind numbers, strings, bigints, buffers, and null`. Confirmed on `@stainless-code/codemap@0.11.4` (Node / better-sqlite3) via `churn-complexity-hotspots` / `stale-imports` — defaults alone suffice. Found during an external repo survey.
>
> **Grilled:** 2026-08-10 — decisions below are locked. Delete this plan on merge (no architecture lift unless maintainers want a durable bind note).

---

## Agent start here

**Branch from default (`main`), not** `chore/blume-*`. **PR-only** (no GitHub issue). Changeset + tests required.

### Key touchpoints

| Area             | Path                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Coerce           | `src/application/recipe-params.ts` (`coerceParamValue` boolean arm)                                                                        |
| Unit tests       | `src/application/recipe-params.test.ts`                                                                                                    |
| Bind types       | `src/application/query-engine.ts` (`QueryBindValue`) vs `src/sqlite-db.ts` (`BindValues`)                                                  |
| Bind call sites  | `query-engine` `executeQueryOnDb`; `index-engine` `queryRows` / `printQueryResult`; `query-baseline` — **do not** add a second coerce here |
| Action templates | `apply-command-template.ts` + `cmd-query.test.ts` / `apply-command-template.test.ts` — expect `0`/`1` after coerce                         |
| Affected recipes | `templates/recipes/{churn-complexity-hotspots,stale-imports,migrate-deprecated,rename-preview}.{md,sql}` — SQL already uses `= 0` / `!= 0` |
| CI gate          | `.github/workflows/ci.yml` Node smoke — extend after minimal index                                                                         |

### Architecture (bug path)

```text
CLI/MCP/HTTP params
  → resolveRecipeParams / coerceParamValue
       boolean arm → 1 | 0 (numbers)   ← fix here
  → values[] → db.query(sql).all(...values)
       better-sqlite3 accepts numbers
SQL recipes already: … = 0 / != 0
```

### Tracer bullet

1. Red: unit test that resolved boolean binds are `0`/`1`.
2. Green: coerce boolean → `1`/`0` in `coerceParamValue`; update expectations + action-template pins.
3. Verify: unit tests + CI Node smoke running one boolean-default recipe.

### Out of scope

- Symbol-table `bindings` / `bindings-engine` (unrelated domain noun).
- MCP `NODE_MODULE_VERSION` mismatch (separate Core bug if filed).
- Merchant-dashboard survey followups / substrate work.
- Recipe SQL rewrites (already integer-shaped).
- New schema / `SCHEMA_VERSION` bump.
- Agent-content / skill narrative edits.
- Display map for pretty `true`/`false` in action templates.
- Defensive coerce at `queryRows` / `executeQueryOnDb`.
- GitHub Core bug issue (PR is the tracker).

### Verification

```bash
bun test src/application/recipe-params.test.ts
bun test src/application/apply-command-template.test.ts
bun test src/cli/cmd-query.test.ts
# local Node path (mirrors CI):
node dist/index.mjs query --json --recipe churn-complexity-hotspots --root fixtures/minimal
# (after build + index of fixtures/minimal; empty rows OK — bind must not throw)
```

---

## Pre-locked decisions (grilled)

| #    | Decision                                                                                                                                                                                                                                   | Source                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| L.1  | **Coerce at resolve time** — `coerceParamValue` for `type: "boolean"` returns `1` \| `0`, never JS `boolean`. Input still accepts `true`/`false`/`1`/`0` (string or number).                                                               | Grill · SQLite / better-sqlite3 bind types |
| L.2  | **One `values[]`** — no display map. Action `{{param}}` / `formatParamsCli` render `0`/`1`. Update tests that pinned `true`/`false`.                                                                                                       | Grill                                      |
| L.3  | **Narrow `QueryBindValue`** — drop `boolean` (align with `BindValues` + `bigint` if still needed).                                                                                                                                         | Type matches runtime                       |
| L.4  | **`RecipeParamValue` still accepts input `boolean`** — MCP `z.boolean()` / CLI; resolved boolean-param slots are numbers.                                                                                                                  | Call surface unchanged                     |
| L.5  | **No recipe SQL / frontmatter type changes** — `type: boolean` stays.                                                                                                                                                                      | Predicate-as-API                           |
| L.6  | **Changeset (patch)** — user-visible: boolean recipe params no longer throw at bind.                                                                                                                                                       | Consumer surface                           |
| L.7  | **No second coerce at DB edge** — resolver is the single contract.                                                                                                                                                                         | Grill                                      |
| L.8  | **PR-only** — no Core bug issue.                                                                                                                                                                                                           | Grill                                      |
| L.9  | **No agent-content edits** — caller types remain `string \| number \| boolean`; wire `0`/`1` is impl detail.                                                                                                                               | Grill · docs Rule 10                       |
| L.10 | **Regression gate** — unit contract **and** CI Node smoke runs one boolean-default recipe (prefer `churn-complexity-hotspots` after existing `fixtures/minimal` Node full index; empty rows OK). Bun-only recipe tests are not sufficient. | Grill                                      |

Inspiration cite: [SQLite bind API](https://www.sqlite.org/c3ref/bind_blob.html) + better-sqlite3 accepted types — not peer indexers.

---

## Implementation slices (tracer bullets)

### Slice 1 — coerce + unit contract (must ship)

1. Change boolean arm in `coerceParamValue` to return `1` / `0`.
2. Update `recipe-params.test.ts` expectations (`false` → `0`, `true` → `1`).
3. Assert resolved values never include `typeof === "boolean"`.
4. Narrow `QueryBindValue` (drop `boolean`); fix type fallout.
5. Update action-template / cmd-query tests that pin `include_type_only=true|false` → `0|1`.

**Done when:** unit tests green; `resolveRecipeParams` never puts a boolean in `values[]`.

### Slice 2 — CI Node smoke (same PR)

1. In `.github/workflows/ci.yml`, after Node full index of `fixtures/minimal`, run e.g.  
   `node dist/index.mjs query --json --recipe churn-complexity-hotspots`  
   (with `CODEMAP_ROOT` / `--root` as the existing step). Exit 0 is enough; do not require non-empty rows.
2. Optionally also `stale-imports` if cheap; one recipe is the locked minimum.

**Done when:** CI Node job would have failed on 0.11.4’s boolean bind error.

### Slice 3 — ship hygiene

1. Changeset (patch).
2. On merge: delete this plan; **no** architecture/glossary lift unless a durable “boolean params bind as INTEGER 0/1” note is wanted (default: lift nowhere — bug fix).

---

## Acceptance

- [ ] `coerceParamValue` / `resolveRecipeParams` emit `0`/`1` for boolean params (all input spellings)
- [ ] `QueryBindValue` has no `boolean`
- [ ] Action template tests updated for `0`/`1`
- [ ] CI Node smoke runs a boolean-default recipe against `fixtures/minimal` via `node dist/index.mjs`
- [ ] Changeset present; no schema bump; no agent-content edit; no GitHub issue required

---

## Risks / non-goals

| Risk                                    | Mitigation                                      |
| --------------------------------------- | ----------------------------------------------- |
| Bun dogfood hides the bug               | L.10 CI Node smoke                              |
| Action templates change `false` → `0`   | CLI accepts both; update pinned tests           |
| Future path feeds raw boolean to `.all` | L.3 type narrowing; no silent edge coerce (L.7) |

**Non-goals:** display map; bind-boundary coerce; recipe YAML/SQL rewrites; MCP native-module ABI; agent-content; filing a Core bug issue.

---

## Dependencies

- Runtime split: [packaging.md § Node vs Bun](../packaging.md#node-vs-bun)
- Tenet: predicate-as-API — recipes must run; bind wire format is an implementation detail
