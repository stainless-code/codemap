# AST-hash duplication — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~2 weeks)
>
> **Motivator:** Agents and maintainers need to find **structurally identical** function bodies across files — same control-flow shape, not merely copy-pasted text with renamed identifiers. Token-level suffix-array engines solve a different problem (literal clones). Codemap exposes duplication as **substrate + recipe**: `symbols.body_hash` at parse time + bundled `duplicates` recipe (`GROUP BY body_hash HAVING COUNT(*) > 1`). No severity primitive, no suppression-by-default.
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)

---

## Agent start here

Ship **`body_hash` column + migration + one parse fixture** before the `duplicates` recipe. Add a **new extractor** (or extend `symbolsExtractor` pop path) in the **same oxc visitor pass** ([substrate-extraction R.1](./substrate-extraction.md#pre-locked-decisions)). Hash only **function-shaped** symbols in slice 1.

### Key touchpoints

| File                                                                 | What to read                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`src/extractors/symbols.ts`](../../src/extractors/symbols.ts)       | Function/method enter + `functionShapeColumns`; where `line_start`/`line_end` are set |
| [`src/extractors/complexity.ts`](../../src/extractors/complexity.ts) | Pattern for per-symbol body-scoped visitor state                                      |
| [`src/parser.ts`](../../src/parser.ts)                               | `EXTRACTORS` registration order; single-pass walk                                     |
| [`src/db.ts`](../../src/db.ts)                                       | `SymbolRow` (~L886), `insertSymbols`, `SCHEMA_VERSION` migration pattern              |
| [`src/parser.ts`](../../src/parser.ts)                               | `EXTRACTORS` array — register new extractor after `complexityExtractor`               |
| [`src/extractors/types.ts`](../../src/extractors/types.ts)           | `TierExtractor` contract for `bodyHashExtractor`                                      |
| [`src/hash.ts`](../../src/hash.ts)                                   | `hashContent` (SHA-256) for canonical body serialization                              |
| [`templates/recipes/`](../../templates/recipes/)                     | Recipe `.sql` + `.md` pair (e.g. `fan-in`)                                            |
| [`docs/golden-queries.md`](../golden-queries.md)                     | Register golden scenario for `duplicates` recipe                                      |

### Architecture

```text
oxc visitor (existing symbol walk)
  → on function-shaped symbol exit: serialize normalized body AST → hashContent → body_hash
  → symbol row persisted in symbols.body_hash (nullable for non-function kinds)
recipe duplicates
  → SQL GROUP BY body_hash HAVING COUNT(*) > 1
  → rows: hash group + member symbols (file_path, name, line_start)
  → query / MCP / HTTP (Moat A — no new verb)
```

**Not** suffix-array / LCP semantic clones — different problem class (literal copy-paste); stay deferred unless `body_hash` proves insufficient.

### Tracer bullet (slice 1)

1. `body_hash` on `FunctionDeclaration` bodies only; two fixtures with isomorphic bodies → same hash, different names. 2. `SCHEMA_VERSION` bump. 3. `duplicates.sql` returns the pair. Expand to arrows/methods in slice 2.

### Out of scope (v1)

Suffix-array semantic duplication engine; verdict / severity on duplicate groups; default suppressions; hashing type/interface bodies; comment-aware hashing.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                | Source                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B.1 | **New column** `symbols.body_hash TEXT` — nullable; populated for function-shaped symbols only in v1.                                                                   | [Moat B](../roadmap.md#moats-load-bearing)                                 |
| B.2 | **Single-pass extraction** — compute hash in the existing oxc visitor; no second AST walk.                                                                              | [substrate-extraction R.1](./substrate-extraction.md#pre-locked-decisions) |
| B.3 | **Structural, not textual** — hash canonical serialization of the function **body** subtree (not raw `source.slice`), so whitespace-normalized identical logic matches. | Roadmap differentiation vs suffix-array dupes                              |
| B.4 | **Moat-A exposure** — bundled recipe id `duplicates` (SQL join on `body_hash`); consumer applies `LIMIT` / directory filters.                                           | [Moat A](../roadmap.md#moats-load-bearing)                                 |
| B.5 | **SHA-256 hex** — reuse `hashContent` on the canonical body string (same convention as `files.content_hash`).                                                           | [`src/hash.ts`](../../src/hash.ts)                                         |
| B.6 | **No verdict primitive** — recipe returns rows; no `pass`/`fail` on duplicate count.                                                                                    | Moat A                                                                     |

---

## Normalization sketch (v1 default — confirm in impl PR)

Canonical string built from a depth-first walk of the body AST:

- Node `type` + ordered child slots
- **Identifier tokens → placeholder** `$id` (rename-insensitive structural match)
- **Literal values → kind** (`string`, `number`, …) not value (so `"a"` vs `"b"` still match structure-only mode — document false-positive class)
- Skip `loc` / comment attachment
- Exclude `doc_comment` on the symbol row (comments not in body_hash)

Document the exact rules in `architecture.md` when landed so agents can predict matches.

---

## Recipe SQL sketch

```sql
-- illustrative; final SQL in templates/recipes/duplicates.sql
SELECT body_hash,
       COUNT(*) AS duplicate_count,
       GROUP_CONCAT(file_path || ':' || name, ', ') AS members
FROM symbols
WHERE body_hash IS NOT NULL
GROUP BY body_hash
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;
```

v1 may emit one row per group or one row per symbol with `duplicate_group_size` — pick in impl PR (golden-query ergonomics).

---

## Implementation steps

1. **`body-hash.ts` extractor** (or module) — `canonicalizeBody(node): string` + `hashContent`.
2. Wire on function exit in `symbols.ts` (or dedicated `bodyHashExtractor` registered after symbols).
3. Extend `SymbolRow` type + `insertSymbols` + migration in `db.ts`.
4. **`templates/recipes/duplicates.sql` + `.md`** — params: optional `min_count`, `path_prefix`.
5. Golden fixture: two files, same structure different param names → one duplicate group.
6. Negative fixture: same name different bodies → different hashes.
7. Docs — `architecture.md` `symbols.body_hash`; `glossary.md` disambiguate vs suffix-array dupes.

---

### Verification

```bash
bun test src/extractors/*.test.ts   # add body-hash fixtures
bun test src/parser.test.ts         # if parse integration tests exist for fixtures
bun src/index.ts --files <fixture>  # reindex duplicate fixture
bun src/index.ts query --recipe duplicates --json
bun run typecheck                   # SymbolRow + insertSymbols column touch db.ts types
```

Register golden scenario per [`docs/golden-queries.md`](../golden-queries.md); guard via `scripts/query-golden-coverage-matrix.test.mjs`.

---

## Acceptance

- [ ] Two isomorphic function bodies (renamed locals) share `body_hash`
- [ ] Different control flow → different `body_hash`
- [ ] `codemap query --recipe duplicates --json` returns groups with `COUNT > 1`
- [ ] Non-function symbols have `body_hash IS NULL`
- [ ] Incremental reindex updates hash for changed files
- [ ] No new pass/fail CLI verb

---

## Open decisions (impl PR)

| #   | Question                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ |
| Q1  | v1 kinds: `FunctionDeclaration` only, or include arrows / methods / class methods in slice 1?    |
| Q2  | Identifier normalization: all → `$id`, or preserve exported param names for stricter matching?   |
| Q3  | Recipe row shape: one row per duplicate **group** vs one row per **symbol** with group metadata? |
| Q4  | Minimum body size gate (skip `() => x` one-liners) — default off or `min_body_lines` param?      |
| Q5  | Index on `symbols(body_hash)` for recipe perf — add in v1 or measure first?                      |

---

## Dependencies

- Shipped: `symbols` extraction, `hashContent`, recipe loader
- Independent of [churn-complexity-hotspots](./churn-complexity-hotspots.md), [cognitive-complexity](./cognitive-complexity.md)
- Supersedes motivation for suffix-array semantic dupes (stay deferred)
