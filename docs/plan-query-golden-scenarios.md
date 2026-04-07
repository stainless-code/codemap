# Plan: Golden query scenarios & external corpus benchmarking

**Purpose:** A repeatable way to refine **Codemap internals** (parsers, resolver, schema, recipes, CLI) by comparing **`codemap query`** results against **checked-in expectations** on fixed corpora — without building an LLM-in-the-loop chat eval (see [benchmark.md](./benchmark.md) for SQL vs traditional timing).

**Doc index:** [README.md](./README.md) · **Indexing another tree:** [benchmark.md § Indexing another project](./benchmark.md#indexing-another-project)

---

## Goals

| Goal                         | How scenarios help                                           |
| ---------------------------- | ------------------------------------------------------------ |
| **Catch regressions**        | Parser or schema drift shows up as JSON diff vs golden       |
| **Encode “correct” answers** | Human-reviewed expected rows for representative prompts      |
| **Stress realistic size**    | Optional second corpus (large app) beyond `fixtures/minimal` |
| **Stay deterministic**       | Assertions are on **query output**, not model prose          |

## Non-goals

- **SSE / multi-model / auth** harnesses (product AI-chat style) — out of scope for this repo
- **Proving agents follow `.mdc` rules** — measure in Cursor or a separate agent project
- **Replacing** `src/benchmark.ts` — that stays **latency + token proxy**; this plan adds **correctness snapshots**

---

## Relationship to existing pieces

| Existing                  | Role                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `fixtures/minimal/`       | Small **private** fixture; stable for CI                         |
| `src/benchmark.ts`        | Indexed SQL **vs** glob/read/regex **time** (not golden rows)    |
| `bun test`                | Unit tests for parsers, CLI parsing, DB                          |
| `CODEMAP_ROOT` / `--root` | Already supports indexing **any** directory (e.g. another clone) |

This plan adds **golden JSON (or subset rules)** per scenario, plus a **runner** that fails CI when output changes unexpectedly.

---

## No proprietary or third-party app code in this repo

We **do not** commit another product’s source tree, paths, business strings, or golden JSON **derived from** a private app (or any repo we do not own and license for redistribution).

| Safe to commit here                                               | Not committed here                                  |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| **`fixtures/minimal/`** (or other **in-repo** trees we control)   | Clones of private apps                              |
| **Generic SQL** and **`--recipe`** ids (no app-specific literals) | Paths like `app/features/…` from a real product     |
| **Golden JSON** produced only from **our** fixtures               | Snapshots keyed to proprietary module names         |
| **Scenario `prompt` text** as **abstract intent** (see below)     | Verbatim “user prompts” that embed customer wording |

**Tier B stress tests** against a **local** large clone (private or public) stay **out of band**: `CODEMAP_ROOT` points at a path on disk; any goldens for that tree live **gitignored** on the developer machine or in a **private** automation bucket — not in `stainless-code/codemap`.

---

## Generalizing “test prompts”

**Prompts** in this plan are **not** copy-pasted chat strings from a product. They are **labels for intent**, paired with **queries that are parameterized from fixture-owned data**.

1. **Fixture is the oracle for literals** — In `fixtures/minimal`, we already control file layout, symbol names, and `tsconfig` paths. Scenarios reference **those** names (e.g. a deliberate `usePermissions` stub, a deliberate `~/api/client`-style import **if** the minimal fixture defines it). The **prompt** in the catalog reads like: _“Where is `usePermissions` defined?”_ because **minimal** defines that symbol — not because an external product did.

2. **Abstract prompt + `params`** — For docs and maintainability, store:
   - **`prompt_template`**: _“List files that import from alias `{aliasPrefix}`”_
   - **`params`**: `{ "aliasPrefix": "~/api/client" }` only where **minimal** (or a **public** OSS sub-fixture) provides that alias. Same template can be re-used when pointing at an external tree **locally**, with params supplied by a **local-only** config file (gitignored).

3. **Recipes over bespoke SQL** — Prefer **`codemap query --recipe fan-out`** etc.; prompts become _“top fan-out files”_ with **no path literals** in committed assets.

4. **Optional public Tier-B in CI** — If we need a **bigger** corpus in-repo later, add a **public** OSS submodule or tarball (license OK) with **its own** minimal golden set — still no proprietary code.

5. **Stress without goldens** — [benchmark.md](./benchmark.md) already supports indexing **any** root for **time** and token estimates; that path does not require committing app source or expected rows.

---

## Tier model

| Tier            | Corpus                                                   | When it runs                            | Purpose                                                    |
| --------------- | -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| **A**           | `fixtures/minimal` (in-repo)                             | Every PR / `bun run check`              | Fast, **committed** goldens                                |
| **B**           | **Local path** via `CODEMAP_ROOT` / `--root` (any clone) | Maintainer machine; optional private CI | Scale, aliases, volume — **goldens optional / gitignored** |
| **B′** (future) | Public OSS fixture only                                  | CI optional                             | Larger **committed** corpus we may redistribute            |

**Pinning (Tier B):** If you record goldens locally, pin a **git ref** in a **private** note or gitignored metadata — not in this repo for proprietary trees.

---

## Scenario catalog (concept)

Each **scenario** is a named test with:

- **`id`** — stable slug (`fan-out-top-3`, `import-from-alias`, …)
- **`prompt`** / **`prompt_template`** (optional) — **generic intent** for docs; parameters come from **`params`** or fixture-defined constants (never proprietary strings)
- **`query`** — one of:
  - Raw SQL string, or
  - **`recipe: "<id>"`** resolving to `QUERY_RECIPES` (same text as CLI)
- **`expect`** — machine-checkable:
  - **Full JSON snapshot** (strict), or
  - **Subset / predicate** (e.g. must include row `from_path` containing `X`, min row count), or
  - **Exit behavior** (e.g. invalid SQL → exit 1 + JSON error shape)

**Storage options (pick one in implementation):**

1. **`scenarios/*.json`** — array of scenarios + paths to golden files under `scenarios/goldens/minimal/...`
2. **Single `scenarios.ts`** — exported array + inline `expect` for tiny cases

Start with **minimal** set of scenarios; grow as parsers gain coverage.

---

## Runner behavior (high level)

1. Resolve **root** (`fixtures/minimal` or `CODEMAP_ROOT` / `--root`).
2. **Index** — `--full` for Tier A in CI; Tier B may use `--full` once per run or assume fresh DB from env.
3. For each scenario: run **`codemap query --json`** (or API `query()` with same SQL) **without** network.
4. Compare result to **expect**; on mismatch, print diff and exit non-zero.
5. Optional: **timing** line per scenario (informational; not a gate unless thresholds are set later).

**Invocation sketch:**

```bash
# Tier A (CI)
bun run scripts/query-golden.ts --corpus minimal

# Tier B (developer machine — any clone; do not commit paths or goldens from private apps)
CODEMAP_ROOT=/path/to/your/local/clone bun run scripts/query-golden.ts --corpus external
```

---

## Phased implementation (tracer bullets)

### Phase 1 — Minimal vertical slice

- [x] 1–3 scenarios on **`fixtures/minimal`** — [fixtures/golden/scenarios.json](../fixtures/golden/scenarios.json) (`files-count`, `symbol-usePermissions`, **`index-summary`** recipe).
- [x] Runner: [scripts/query-golden.ts](../scripts/query-golden.ts); goldens under [fixtures/golden/minimal/](../fixtures/golden/minimal/).
- [x] **`package.json`**: `test:golden`; **`bun run check`** runs it after parallel checks; **CI** runs it in the Test job.
- [x] [benchmark.md](./benchmark.md) § Fixtures + [CONTRIBUTING.md](../.github/CONTRIBUTING.md).

### Phase 2 — Catalog + ergonomics

- [x] Formalize schema (Zod) for scenario entries — [scripts/query-golden/schema.ts](../scripts/query-golden/schema.ts).
- [x] `bun scripts/query-golden.ts --update` to **refresh** goldens from current Codemap (developer confirms diff).
- [x] CONTRIBUTING note: when to update goldens vs fix parser.

### Phase 3 — Tier B corpus

- [x] Document how to point **`CODEMAP_ROOT`** / **`--root`** at a **local** large tree; **gitignore** generated goldens (`fixtures/golden/external/`, optional `scenarios.external.json`).
- [ ] Optional **GitHub Actions** `workflow_dispatch` only if using a **public** corpus — **not** for private app code (deferred).
- [x] External scenarios are **not** in default `bun run check` — use **`test:golden:external`** locally; CI keeps **`test:golden`** (minimal) only.

### Phase 4 — Optional tightening

- [x] Subset matchers: **`minRows`**, **`everyRowContains`** (see schema); default **`exact`** remains full JSON vs golden file.
- [x] Optional **`budgetMs`** per scenario (warn; **`--strict-budget`** exits 1) — separate from correctness.

---

## Success criteria

- **Phase 1** is “done” when CI fails on an intentional parser regression against `fixtures/minimal`.
- **Phase 3** is “done” when a maintainer can run one command against a **local** pinned tree (optional goldens **outside** this repo for private code) and get a green/red **correctness** report, independent of `src/benchmark.ts` speedups.

---

## Open decisions

| Question                         | Options                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| Where do scenarios live?         | `scripts/query-golden/`, top-level `fixtures/scenarios/`, or `test/golden/`              |
| Strict vs subset matching        | Start strict on minimal; relax for Tier B                                                |
| DB location for Tier B           | Default `<root>/.codemap.db` — ensure `.gitignore` in that repo or use temp copy         |
| Tier B goldens for private repos | **Never commit** — use `*.local.json` gitignored, or a private fork / CI vault           |
| Larger committed corpus          | Only **public** OSS (license OK) or **generated** synthetic trees checked in as fixtures |

---

## References

- [benchmark.md](./benchmark.md) — methodology for **speed** comparisons
- [architecture.md](./architecture.md) — schema and parsers
- [roadmap.md](./roadmap.md) — backlog pointer
