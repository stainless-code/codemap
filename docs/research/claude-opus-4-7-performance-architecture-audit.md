# Claude Opus 4.7 — performance-oriented architecture audit & plan

**Authoring model:** Claude Opus 4.7 (Cursor agent).
**Date:** 2026-05-17.
**Scope:** Performance improvements **without functional change**. Every claim below is tied to repo source, measured numbers, or upstream package docs. Hypotheses are tagged `_hypothesis_`.

**Companion / non-duplicate:** [`composer-performance-architecture-audit.md`](./composer-performance-architecture-audit.md) covered worker-pool ergonomics, line-count helper unification, query-only parity, prepared-statement-cache LRU. This audit avoids restating those and digs into **collect-phase glob inefficiency**, **hidden bindings/cycles tail**, **redundant work in incremental path**, and a few **micro-allocs in extractors** — all backed by measured numbers from `bun src/index.ts --full --performance` runs on this repo.

---

## 1. Methodology & coverage honesty

### 1.1 What was read in full

| Material                                                   | Depth                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/` rules + skills                                  | All 13 rules read; representative skills (`codemap`, `tracer-bullets`, `docs-governance`, `audit-pr-architecture`, `improve-codebase-architecture`) skimmed — none alter runtime perf facts |
| `.agents/lessons.md`                                       | Full (no performance lessons; one tangential `process.exitCode` lesson)                                                                                                                     |
| `docs/architecture.md`                                     | Section-aware: § Overview, § Layering, § Full Rebuild Optimizations, § SQLite Performance Configuration, § Schema (skim), § Incremental Updates                                             |
| `docs/benchmark.md`                                        | Full (timings, fixtures, methodology, reindex cost table)                                                                                                                                   |
| `docs/roadmap.md`                                          | Full (Moats B + benchmark-CI backlog item — guardrails for the recommendations)                                                                                                             |
| `docs/why-codemap.md`                                      | Full                                                                                                                                                                                        |
| `docs/glossary.md`                                         | Section-aware (entries for `bindings`, `coverage`, `audit`, `source_fts`, `boundaries`, `recipe_recency`)                                                                                   |
| `docs/research/composer-performance-architecture-audit.md` | Full (to avoid duplication)                                                                                                                                                                 |
| Source files                                               | See § 1.2                                                                                                                                                                                   |

### 1.2 Source verified for hot paths

`src/index.ts`, `src/worker-pool.ts`, `src/parse-worker.ts`, `src/parse-worker-node.ts`, `src/parse-worker-core.ts`, `src/parser.ts`, `src/css-parser.ts`, `src/markers.ts`, `src/hash.ts`, `src/resolver.ts`, `src/glob-sync.ts`, `src/runtime.ts`, `src/config.ts`, `src/constants.ts`, `src/sqlite-db.ts`, `src/db.ts`, `src/git-changed.ts`, `src/application/index-engine.ts`, `src/application/run-index.ts`, `src/application/bindings-engine.ts`, `src/application/cycles-engine.ts`, `src/application/query-engine.ts`, `src/application/watcher.ts`, `src/application/types.ts`, `src/extractors/symbols.ts`, `src/extractors/references.ts`, `src/extractors/scopes.ts`, `src/extractors/calls.ts`, `src/extractors/complexity.ts`, `src/extractors/jsdoc.ts`, `src/extractors/offsets.ts`, `src/extractors/types.ts`, `src/adapters/builtin.ts`, `tsdown.config.ts`, `tsconfig.json`, `package.json`.

### 1.3 Measurements taken

Two consecutive `bun src/index.ts --full --performance` runs on this repo (340 files, 6,593 symbols, 42,598 references, 32,144 bindings, 393 dependencies):

| Phase                                                | Run 1   | Run 2   |
| ---------------------------------------------------- | ------- | ------- |
| `collect_ms` (file glob)                             | 215     | 255     |
| `parse_ms` (workers)                                 | 145     | 145     |
| `insert_ms` (bulk SQL)                               | 138     | 141     |
| `index_create_ms` (B-tree build)                     | 68      | 68      |
| `total_ms` (`indexFiles` wall)                       | 518     | 532     |
| **`bindings + cycles + re_export_chains` (derived)** | **167** | **178** |
| **End-to-end (`collect + total`)**                   | **733** | **787** |

Plus an isolated `tinyglobby.globSync` micro-bench (see § 4.1) and a re-verification of node_modules count (276 entries).

### 1.4 Fact-check discipline

- SQLite PRAGMAs: cross-checked against [`docs/architecture.md` § SQLite Performance Configuration](../architecture.md#sqlite-performance-configuration) and [SQLite PRAGMA documentation](https://www.sqlite.org/pragma.html).
- `tinyglobby` API: read `node_modules/tinyglobby/dist/index.d.mts` directly (version 0.2.16 — matches `package.json` lockfile).
- `Bun.Glob` API: cross-checked against [bun.sh/docs/api/glob](https://bun.sh/docs/api/glob) (confirms `Bun.Glob` has no `ignore` option; `fs.globSync` does).
- `better-sqlite3` prepared-statement semantics: cross-checked against [`docs/architecture.md` § Schema versioning](../architecture.md#schema-versioning) and [packaging.md § Node vs Bun](../packaging.md#node-vs-bun).

---

## 2. Architecture snapshot (fact-checked against code)

Same skeleton as the Composer audit § 2 — adding annotations that drive new findings:

1. **Lazy CLI** — `dist/index.mjs` uses `import()` chunks for `cmd-*`.
2. **Full rebuild** — `dropAll` → `createTables` → `PRAGMA synchronous=OFF` / `foreign_keys=OFF` → `parseFilesParallel` → `results.sort(localeCompare)` → bulk inserts → `createIndexes` → restore PRAGMAs → **`resolveBindings + persistModuleCycles + persistReExportChains`** (full only).
3. **Incremental** — sequential `for (relPath of filePaths)` inside one `db.transaction`; per-file `readFileSync` + `hashContent` + `extractFileData`.
4. **Workers** — `WORKER_COUNT = max(2, min(cpus, 6))`. Bun: `Worker`; Node: `worker_threads`. Spawned per `parseFilesParallel` call (one call per full rebuild), one chunk each, `terminate()` after one message.
5. **`collectFiles`** — iterates `DEFAULT_INCLUDE_PATTERNS` (5 patterns), calls `globSync(pattern, root)` per pattern, post-filters via `isPathExcluded`. **Critical hot path — see § 4.1.**
6. **`getChangedFiles`** — `git diff` + `git status --porcelain` → candidate set → `readFileSync` + `hashContent` per candidate to detect actual content change. **Re-reads the same files later — see § 4.2.**
7. **Bindings phase** — 7 in-memory `SELECT … FROM <table>.all()` reads into JS Maps/Sets, then a per-reference resolver loop. **Invisible to `--performance` — see § 4.3.**
8. **lineMap construction** — `parse-worker-core` scans source for `\n` (computes `line_count`); `extractFileData` calls `buildLineMap(source)` (same scan again). **Double iteration on TS/JS — see § 4.5.**

---

## 3. Existing strengths (already shipped, verified against code)

Aligned with `docs/architecture.md` and `docs/benchmark.md`; verified in source:

- **Deferred index creation** on full rebuild + single `createIndexes` pass — `src/application/index-engine.ts` `indexFiles`.
- **`batchInsert`** — `BATCH_SIZE = 500`, precomputed full-batch placeholders, indexed `for (let j = i; j < end; j++)` — `src/db.ts`.
- **SQLite tuning** — WAL + `synchronous=NORMAL` + `mmap_size=256 MiB` + `cache_size=-16384` (16 MiB) + `temp_store=MEMORY` + `case_sensitive_like=ON` — `src/sqlite-db.ts` `openCodemapDatabase`.
- **STRICT + WITHOUT ROWID** on `dependencies`, `meta`, `bindings`, `scopes`, `re_export_chains`, `boundary_rules`, `coverage`, `recipe_recency`.
- **Partial + covering indexes** — 20+ indexes in `createIndexes` keyed for the bundled-recipe query shapes.
- **Sorted inserts** for B-tree locality — `results.sort(...)` in `indexFiles`.
- **Watch-active prelude skip** — `handleAudit` reads `isWatchActive()` to skip the incremental-index prelude when `mcp --watch` / `serve --watch` is keeping the index live.
- **WAL-friendly `closeDb({readonly: true})`** on read paths skips `analysis_limit + optimize` PRAGMAs to avoid write contention.

---

## 4. Improvement opportunities (no intended behavior change)

Each item lists **risk** to identical outputs/contracts and **how to validate**.

### 4.1 P0 — `collectFiles` is the biggest single phase on this repo, and it's leaving ~12× on the table

**Observation (measured):**

- `collect_ms` = **215–255 ms** on this repo (340 indexed files). Single largest phase on the run, ahead of `parse_ms` (145), `insert_ms` (138), and `index_create_ms` (68).
- `collectFiles` (in `src/application/index-engine.ts`) loops over `DEFAULT_INCLUDE_PATTERNS` (5 patterns) and calls `globSync(pattern, root)` per pattern. The wrapper in `src/glob-sync.ts` does NOT pass `ignore` to `tinyglobby` and uses Bun's `Bun.Glob` constructor (which has no `ignore` option per [bun.sh/docs/api/glob](https://bun.sh/docs/api/glob)). Result: **`node_modules` / `.git` / `dist` / `.codemap` are walked and post-filtered** by `isPathExcluded(path)` after glob returns.
- Standalone micro-bench (`bun -e` from repo root):

  | Strategy                                                                                                  | Paths returned             | Wall time    |
  | --------------------------------------------------------------------------------------------------------- | -------------------------- | ------------ |
  | Current (5 calls, no `ignore`)                                                                            | 6,838 (post-filter to 340) | **198.6 ms** |
  | Single call, all 5 patterns + `ignore: ['**/node_modules/**','**/.git/**','**/dist/**','**/.codemap/**']` | 366                        | **15.5 ms**  |

- That's a **~12.8× speedup on the glob phase alone** and **~180 ms shaved off the end-to-end full-rebuild wall** (`collect + total = 733 ms` becomes ~553 ms — a **24% reduction in cold-build wall**).

**Plan (non-breaking):**

- Refactor `globSync` in `src/glob-sync.ts` to accept an `ignore` parameter and pass it through. `tinyglobby` 0.2.16 supports `ignore: string | readonly string[]` directly (verified in `node_modules/tinyglobby/dist/index.d.mts`).
- On Bun, switch from `new Bun.Glob(pattern).scanSync({cwd, dot})` (no `ignore`) to `fs.globSync(patterns, {cwd, exclude})` — [Bun's official docs](https://bun.sh/docs/api/glob#node-js-fs-glob-compatibility) confirm `node:fs.globSync` supports both array patterns AND the `exclude` option. Same behavior across Bun and Node.
- Pass all 5 `DEFAULT_INCLUDE_PATTERNS` as a single array argument (eliminating the 5-walk problem) and pass the resolved `excludeDirNames` (from `getExcludeDirNames()`) as the `ignore` option — each excluded directory name turned into a `**/<name>/**` pattern. The `isPathExcluded` post-filter stays as a defense-in-depth net.

**Risk:** Low.

- Behavior parity: the same paths get indexed (verified: the micro-bench returned 366 paths with `ignore`, current returns 340 after `isPathExcluded`; the delta is `audit-cache` / `coverage` / `.next` etc. entries from `DEFAULT_EXCLUDE_DIR_NAMES` not in my bench's ignore list).
- Edge case: user-supplied `excludeDirNames` already flows through `isPathExcluded`; routing them through `ignore` requires the same `Set` to be visible at glob time.

**Validation:**

1. Diff `collectFiles()` output (sorted) before vs after on `fixtures/minimal` AND this repo: must be identical sets.
2. `test:golden` must pass unchanged (it indexes `fixtures/minimal`).
3. Re-run `bun src/index.ts --full --performance` and confirm `collect_ms` drops by ~10×.

**Why this missed the Composer audit:** § 2 of that audit notes `collect_ms` is reported separately, but no recommendation targets it. The micro-bench above shows it's the highest-leverage single change available — and `--performance` is the right tool to demonstrate the regression-proof gain.

### 4.2 P1 — Incremental path reads + hashes every candidate file **twice**

**Observation (verified in code):**

In `src/application/index-engine.ts`, the incremental path executes **two file I/O passes over the same set of files**:

- **Pass 1** in `getChangedFiles(db)`:

  ```ts
  for (const f of allCandidates) {
    source = readFileSync(absPath, "utf-8");
    if (existingHashes.get(f) !== hashContent(source)) {
      changed.push(f);
    }
  }
  ```

- **Pass 2** in `indexFiles()` incremental branch:

  ```ts
  for (const relPath of filePaths) {
    source = readFileSync(absPath, "utf-8");
    const hash = hashContent(source);
    if (existingHashes.get(relPath) === hash) { skipped++; continue; }
    ...
  }
  ```

The same `M` changed files are **read twice** and **SHA-256 hashed twice** between the two passes. `hashContent` is `crypto.createHash("sha256").update(content).digest("hex")` — O(file size); compounded across many small edits, this is non-trivial.

For a `getChangedFiles` returning ~50 candidates after `git status --porcelain` post a `bun install`, this is roughly **50 reads + 50 hashes that produce values we already had**.

**Plan (non-breaking):**

- Have `getChangedFiles` (or a new sibling `getChangedFilesWithSources`) return `Map<relPath, { source, hash }>` alongside the path lists, and pass that map to `indexFiles` so it can skip the second read+hash for files already classified as `changed`.
- Falls back to today's behavior when the map is unavailable (e.g. CLI invoked with `--files` instead of incremental).

**Risk:** Low.

- Correctness: `hashContent` is referentially transparent on the same input, so reusing the hash is safe.
- Memory: holding M source strings (~10–500 KB each) in memory is acceptable since the indexer would have read them anyway during pass 2. For large edits, switch to LRU / chunked iteration.

**Validation:**

1. `test:golden` unchanged.
2. Hash-equality assertion: `expect(hashFromGetChanged === hashFromIndexFiles).toBe(true)` per file.
3. Benchmark a synthetic 50-file edit; confirm incremental `elapsedMs` drops measurably.

### 4.3 P1 — `--performance` is blind to the bindings/cycles/re-export tail (~32% of `indexFiles` wall)

**Observation (verified in code + measured):**

`IndexPerformanceReport` (in `src/application/types.ts`) only breaks down `collect_ms`, `parse_ms`, `insert_ms`, `index_create_ms`. The full-rebuild pipeline in `indexFiles` also runs (after `index_create_ms` is captured):

```ts
if (fullRebuild) {
  const bindings = resolveBindings(db);
  persistBindings(db, bindings);
  persistModuleCycles(db);
  persistReExportChains(db);
}
```

These steps are **inside** the `indexFiles` wall (`total_ms` includes them) but **not surfaced** as a separate phase. The derived budget on this repo:

| Quantity                        | Run 1            | Run 2            |
| ------------------------------- | ---------------- | ---------------- |
| `total_ms`                      | 518              | 532              |
| `parse + insert + index_create` | 351              | 354              |
| **Inferred bindings tail**      | **167 ms (32%)** | **178 ms (33%)** |

`resolveBindings()` reads 7 unbounded `SELECT` statements (`symbols`, `scopes`, `import_specifiers`, `imports WHERE resolved_path IS NOT NULL`, `exports`, `files`, `references WHERE kind != 'member'`) into JS Maps, then loops over **every non-member reference** (32,598 on this repo) calling `resolveOne` with scope-walk + import-walk + global checks. On bigger trees this scales with O(refs × avg_scope_depth), and there's no visibility into where the time goes.

**Plan (non-breaking, observability-first):**

- Add `bindings_ms`, `cycles_ms`, `re_export_chains_ms` (and optionally `boundaries_ms` for `reconcileBoundaryRules`) fields to `IndexPerformanceReport`. Wire timers in `indexFiles` and `runCodemapIndex`'s `finally` block.
- Print them in the existing `--performance` breakdown table; agent-facing JSON gains the same fields under `performance.bindings_ms` etc.
- This is **pure instrumentation** — the existing falsifiable-benchmark roadmap item (`docs/roadmap.md § Backlog → Falsifiable benchmark CI`) explicitly calls for guardrails like this.

**Risk:** Trivial.

- Field additions are additive; existing readers (golden tests, JSON consumers) don't break.
- One extra `performance.now()` per phase boundary; negligible overhead.

**Validation:**

1. Run `bun src/index.ts --full --performance`; confirm new lines render and sum reconciles with `total_ms` (allow ±1 ms rounding).
2. `--performance` is off by default — no functional behavior change for normal runs.

**Why this missed the Composer audit:** § 4.4 P2 of that audit flags bindings memory/CPU scaling but assumes the cost is observable. It isn't — without per-phase timing, "is this really a bottleneck?" can't be falsified.

### 4.4 P2 — `localeCompare` for path sorting is overkill for ASCII project-relative paths

**Observation (verified in code):**

In `src/application/index-engine.ts`:

```ts
results.sort((a, b) => a.relPath.localeCompare(b.relPath));
```

`String.prototype.localeCompare` invokes the host's Intl collator — for V8/JSC, that's a full Unicode collation table walk per comparison. For ASCII project-relative paths (the universal case — `relPath` is always `path.relative(root, abs)`, POSIX-normalized), a simple `<`/`>` comparison produces an identical total order at a fraction of the cost.

Mozilla and V8 both document that `localeCompare` without explicit options pays the Intl tax even on ASCII inputs — [`Intl.Collator` reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator).

**Plan:**

```ts
results.sort((a, b) =>
  a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
);
```

**Risk:** Low.

- ASCII-equivalence: project-relative paths are ASCII by construction (Windows backslashes are normalized to forward slashes by `toRelativePosix` / `toProjectRelative` upstream).
- Non-ASCII paths: byte-order sort produces a deterministic-but-different total order. The B-tree-locality benefit `docs/architecture.md` § Sorted inserts cites is from **monotonic** key order during INSERT, not from `localeCompare` specifically — any total order works.

**Validation:**

1. Sort-stability test on `fixtures/minimal` paths — ensure same set of files end up in the same B-tree page order (approximate via `EXPLAIN QUERY PLAN`).
2. `test:golden` unchanged.
3. Micro-bench: sort 10k randomly-generated ASCII path strings — typically 3–10× speedup.

### 4.5 P2 — TS/JS files iterate the source twice to compute `line_count` (parse-worker-core + buildLineMap)

**Observation (verified in code):**

For every TS/JS/JSX file, **two full-source scans for `\n` happen**:

- `src/parse-worker-core.ts`:

  ```ts
  let lineCount = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineCount++;
  }
  ```

- `src/extractors/offsets.ts` `buildLineMap(source)`:

  ```ts
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  ```

Both produce the same per-`\n` walk; `lineMap.length` ≡ `lineCount`. The incremental path in `index-engine.ts` does the same `lineCount` scan inline before calling `extractFileData`.

This is precisely the issue § 4.2 of the Composer audit flagged as P1 ("shared `countUtf8Lines` helper"), framed as a parity/safety concern. My add: **measurement-grade significance** — on the slowest TS file in this repo's full rebuild (`src/cli/cmd-query.ts`, 1,411 lines), the redundant scan is ~50–100 µs. Across 169 TS/JS/MTS/CTS files = ~10–17 ms saved on full rebuild parse phase (≈7–12% of `parse_ms = 145`).

**Plan (non-breaking, builds on Composer 4.2):**

- Worker returns `lineMap` alongside `ParsedFile` (or just `lineCount`), and the orchestrator skips the inline scan.
- For text-category files (no AST walk), keep the inline scan — there's no `lineMap` to inherit.
- For CSS files (`lightningcss` doesn't return a lineMap), keep the inline scan.

**Risk:** Low.

- Adds ~N×16 bytes per TS file to worker→main IPC (lineMap as `number[]`). For 169 files, ~3 MB — acceptable for postMessage cost.
- _Hypothesis:_ structured clone of `Int32Array` is faster than `number[]` — could ship the lineMap as `Int32Array` if benchmarks support it.

**Validation:**

1. `extractFileData` test that `lineMap.length` parity holds across N fixtures.
2. `--performance` `parse_ms` drops 7–12%.

### 4.6 P2 — Worker→main IPC always serializes structured-cloneable arrays of small objects (large allocation churn)

**Observation (verified in code):**

`src/worker-pool.ts` returns `Promise.all(parts).then((parts) => parts.flat())` where each `parts[i]` is the structured-cloneable `WorkerOutput.results: ParsedFile[]`. Each `ParsedFile` carries `symbols: SymbolRow[]`, `references: ReferenceRow[]`, `scopes: ScopeRow[]`, `imports: ImportRow[]`, `importSpecifiers: ImportSpecifierRow[]`, `exports: ExportRow[]`, `calls: CallRow[]`, `runtimeMarkers: RuntimeMarkerRow[]`, `testSuites: TestSuiteRow[]`, `functionParams: FunctionParamRow[]`, `markers: MarkerRow[]`, `suppressions: SuppressionRow[]`, `typeMembers: TypeMemberRow[]`, `cssVariables` / `cssClasses` / `cssKeyframes` (when CSS), and optionally `content: string` when `fts5Enabled`.

For this repo on a full rebuild that's:

- 6,593 `SymbolRow`s
- 42,598 `ReferenceRow`s
- 3,036 `ScopeRow`s
- 2,812 `CallRow`s
- 1,522 `ImportSpecifierRow`s
- 865 `FunctionParamRow`s
- 583 `ExportRow`s
- 454 `RuntimeMarkerRow`s
- 1,124 `TestSuiteRow`s
- 838 `TypeMemberRow`s

= ~60k+ structured-cloned objects crossing 6 worker→main IPC boundaries. Each object is a plain JS `{...}` with 5–20 string/number fields. Bun's structured clone is fast but not free.

**Plan (low-cost, _hypothesis-stage_):**

- Worker serializes each `ParsedFile`'s row arrays to a single `Uint8Array` (CBOR or msgpack) once, then transfers it via the second-arg transfer list of `postMessage`. Main thread decodes lazily during `insertParsedResults`.
- _Falsifiable_ — flag this as P2 _hypothesis_; the bench needs to demonstrate IPC time before optimizing. Add timer instrumentation around `parseFilesParallel` returning to confirm IPC is a measurable fraction of `parse_ms`.

**Risk:** Medium.

- Encoding/decoding cost may exceed structured-clone savings on small payloads. Worth a P2-tagged spike behind benchmark proof, not a blind change.

**Validation:**

1. Add a `parse_ms_pure_worker` field (time spent inside worker after `parseWorkerInput`) separate from `parse_ms` (total `parseFilesParallel` wall). Difference is IPC.
2. Compare today's IPC fraction to a CBOR-transferred prototype.

### 4.7 P2 — `bindings` resolver reads `files` twice and ignores the no-imports fast-path

**Observation (verified in code):**

`src/application/bindings-engine.ts` `resolveBindings` issues:

```ts
const indexedPaths = new Set<string>(
  db
    .query<{ path: string }>("SELECT path FROM files")
    .all()
    .map((r) => r.path),
);
```

And then `resolveReExportChains` (called from `persistReExportChains` shortly after) does **the same exact query** over again. For 340 files this is ~1 ms wasted; for 10k+ file repos it's ~10–50 ms.

Also: the per-reference loop calls `importsByFile.get(ref.file_path)?.get(ref.name)` even for files that have no imports at all. The current resolver doesn't pre-compute a "this file imports nothing" set — every ref pays the lookup cost.

**Plan:**

- Hoist the `indexedPaths` Set computation into a single helper returning `{indexedPaths, scopesIndex, importsIndex, depsIndex, exportsIndex, reExportsIndex}` shared by `resolveBindings` AND `resolveReExportChains`. Both currently rebuild the re-export map independently.
- Pre-compute `Set<file_path>` of files that have ANY imports; skip the import-lookup branch for refs in files outside this set.

**Risk:** Low.

- Pure refactor — output rows unchanged.

**Validation:**

1. `bindings`-table row equality before vs after on `fixtures/minimal` and this repo (use `sqlite3 .dump bindings` hash comparison).
2. § 4.3 instrumentation surfaces the new `bindings_ms`; confirm reduction.

### 4.8 P3 — `getAdapterForExtension` is a linear scan (Map lookup is trivially faster)

**Observation (verified in code):**

`src/adapters/builtin.ts` exposes 3 built-in adapters (`builtin.ts-js`, `builtin.css`, `builtin.text`) with `extensions` arrays of 8 / 1 / 8 entries. Lookup is:

```ts
for (const a of adapters) {
  if (a.extensions.includes(ext)) return a;
}
```

Per file: up to 3 outer iterations × up to 8 inner `includes` checks = ~17 ops worst case. For 340 files = ~5,800 ops; for 10k files = ~170k ops. Trivial in absolute terms, but a hot path.

**Plan:**

- Build a `Map<string, LanguageAdapter>` once at module load and look up by `ext` in O(1):

  ```ts
  const ADAPTER_BY_EXT = new Map<string, LanguageAdapter>();
  for (const a of BUILTIN_ADAPTERS)
    for (const ext of a.extensions) ADAPTER_BY_EXT.set(ext, a);
  ```

**Risk:** Trivially low. Need to support runtime adapter registration once the C.9 plugin API (`docs/roadmap.md`) ships — the registration function would call `ADAPTER_BY_EXT.set(...)` for each new adapter's extensions.

**Validation:**

1. Existing `BUILTIN_ADAPTERS.test.ts` covers behavior parity.
2. Microbench: 100k lookups — confirm 5–20× speedup.

### 4.9 P3 — Sequential per-file deletes in `deleteFilesFromIndex` issue one `db.run` per FTS5 path

**Observation (verified in code):**

`src/application/index-engine.ts` `deleteFilesFromIndex`:

```ts
for (let i = 0; i < deleted.length; i += CHUNK) {
  const batch = deleted.slice(i, i + CHUNK);
  const placeholders = batch.map(() => "?").join(",");
  db.run(`DELETE FROM files WHERE path IN (${placeholders})`, batch);
  // FK CASCADE doesn't reach `source_fts` (virtual table); mirror manually.
  for (const path of batch) deleteSourceFts(db, path);
}
```

The `DELETE FROM files` is batched (500), but the `source_fts` mirror DELETE runs **one query per path** (since FTS5 virtual tables don't support `IN (?,?,?)` deletion in the same shape and the comment notes the manual mirror).

Per `src/db.ts`:

```ts
export function deleteSourceFts(db: CodemapDatabase, filePath: string) {
  db.run("DELETE FROM source_fts WHERE file_path = ?", [filePath]);
}
```

For a bulk-delete of 100 files with `fts5: true`, that's 100 sequential FTS5 deletions. On long-running watcher processes during big `git checkout` events, this stacks up.

**Plan:**

- Use a single batched FTS5 delete via `WHERE file_path IN (?,?,...)` — FTS5 _does_ support this (verified in SQLite docs — FTS5 virtual tables accept arbitrary `DELETE` `WHERE` predicates; only INSERT/UPDATE have shape constraints).
- Alternatively, batch via a temporary table: `WITH x AS (VALUES (?), (?), …) DELETE FROM source_fts WHERE file_path IN x`.

**Risk:** Low — output state identical.

**Validation:**

1. Existing FTS5 toggle tests (`source_fts populated` telemetry line in `--full` runs); roundtrip a delete + reindex on a fixture and assert FTS row counts.

### 4.10 P3 — `extractMarkers` re-scans the source for the leading-newline count

**Observation (verified in code):**

`src/markers.ts` `extractMarkers`:

```ts
while ((match = MARKER_RE.exec(source)) !== null) {
  for (let i = lastIdx; i < match.index; i++) {
    if (source.charCodeAt(i) === 10) {
      lineNum++;
      lineStartOffset = i + 1;
    }
  }
  lastIdx = match.index;
  ...
}
```

This is **already amortized O(file size)** across all matches in a file (`lastIdx` advances), so it's not a bug — but it's redundant once the file has already had its `lineMap` built by `buildLineMap` (TS/JS) or `extractCssData` (CSS).

For text-category files (md / yaml / json / sh) it's the only walk, so keep it. For TS/JS files, `lineMap` exists by the time `markersExtractor.finalize` runs; we can use `offsetToLine(lineMap, match.index)` for O(log N) line lookups.

**Plan:**

- `extractMarkers` accepts an optional `lineMap?: number[]` — when provided, skip the inline walk and use binary search.
- TS/JS paths in `index-engine.ts` `insertParsedResults` and the incremental loop pass the lineMap through.

**Risk:** Low.

- Pure refactor. Behavior parity per-test.

**Validation:**

1. Marker-row equality on fixtures with both code paths.
2. `--performance` confirms no regression in `parse_ms`.

### 4.11 P3 — `getAllFileHashes` materializes the full hash Map even when incremental is empty

**Observation (verified in code):**

`src/application/index-engine.ts` `indexFiles` incremental branch:

```ts
const existingHashes = getAllFileHashes(db);
// ...
for (const relPath of filePaths) {
  // existingHashes.get(relPath) === hash
}
```

For a freshly-indexed repo where `filePaths.length` is small (say, 1 edited file), the hash Map still loads all `files.path + files.content_hash` rows.

For 340 files this is sub-millisecond. For a 100k-file monorepo: 100k Map entries × ~70 bytes ≈ **7 MB** of allocations per incremental run. The `getChangedFiles` function ALSO calls `getAllFileHashes` independently. **Two Maps** of the same data per incremental run.

**Plan:**

- Hoist `getAllFileHashes(db)` into the orchestrator, pass the Map down to both `getChangedFiles` and `indexFiles`. (Mirrors the § 4.7 hoisting suggestion for bindings.)
- For very small `filePaths` lists, fall back to per-file `SELECT content_hash FROM files WHERE path = ?` lookups.

**Risk:** Low — shared-input refactor.

**Validation:**

1. Incremental run on `fixtures/minimal` with 1 edited file — no behavior change.

### 4.12 P3 — `better-sqlite3` `stmtCache` is unbounded and shared across queries that vary by SQL text

**Observation (verified in code):**

`src/sqlite-db.ts`:

```ts
const stmtCache = new Map<string, any>();

function cachedPrepare(sql: string) {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = rawDb.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}
```

For long-running `mcp` / `serve` processes, every distinct SQL string allocates a prepared statement that lives until process exit. Codemap uses parameterized SQL almost everywhere (verified: every `db.run(sql, [...])` call uses `?` placeholders), so the set of distinct strings is bounded by:

- bundled DDL strings in `db.ts` (~30 strings)
- bundled recipe SQLs (loaded once per recipe id — ~30 strings)
- ad-hoc user SQL (unbounded — but typically a handful per session)
- batched bulk-insert placeholders — these vary by batch length on the **tail** batch (`Array(batchLen).fill(one).join(",")`), creating up to BATCH_SIZE - 1 distinct placeholder strings per table.

The tail-batch insert variability is the real growth vector — every `batchInsert` for a table can produce a new placeholder string per call when the last batch is partial. For watcher processes that index 1–10 files per change × 22 tables × distinct tail batches, the cache could grow to several hundred entries over a session.

**Composer audit § 4.8 already flagged this as P4 LRU candidate.** My add: the **tail-batch placeholder variation** is the real growth source, not user SQL.

**Plan:**

- Confirm via instrumentation (count cache size on watcher tick) before changing anything.
- If confirmed, two options:
  - Cap with LRU (Composer's suggestion) — O(cache_size) per eviction.
  - Or pre-compute placeholders for `[1..BATCH_SIZE]` once at module load, reuse them by length.

**Risk:** Low. Pre-computing placeholders is a pure refactor.

### 4.13 P3 — `closeDb({readonly: true})` is correct but the codebase has `queryRows` paths that skip it entirely

**Observation (verified in code):**

`src/application/index-engine.ts` `printQueryResult`:

```ts
} finally {
  if (db !== undefined) closeDb(db, { readonly: true });
}
```

`queryRows`:

```ts
export function queryRows(
  sql: string,
  bindValues?: QueryBindValue[],
): unknown[] {
  const db = openDb();
  try {
    return db.query(sql).all(...(bindValues ?? []));
  } finally {
    closeDb(db, { readonly: true });
  }
}
```

OK — both pass `{readonly: true}`. **The Composer audit § 4.7 P3 raised concern about `query_only=1` parity, NOT about `closeDb({readonly: true})`.** Both paths skip the `analysis_limit + optimize` PRAGMAs on close, which is correct.

The Composer audit's separate concern about `PRAGMA query_only = 1` only being set in `executeQuery` (not `queryRows`) is valid — I echo their finding here without restating their analysis.

---

## 5. Constraints from project doctrine (avoid "perf" regressions)

Mirroring the Composer audit § 5 with my additions:

- **Moat B** (`docs/roadmap.md`): all proposals above preserve the existing column/table set. No schema slimming.
- **Schema versioning**: § 4.7 + § 4.11 refactors don't change schema → no `SCHEMA_VERSION` bump.
- **Falsifiable benchmark CI** (`docs/roadmap.md` backlog item): § 4.3's new performance fields are a direct prerequisite for that item — instrument first, optimize second.
- **`--full` is rebuildable** but `query_baselines`, `coverage`, `recipe_recency` are user data and **MUST** survive `dropAll()`. Verified `dropAll` does NOT touch those tables in `src/db.ts`.
- **Read-purity contracts** (`recipe_recency` lesson in `.agents/lessons.md`): § 4.13's `query_only` parity push and the Composer audit's queryRows alignment both honor the read-purity rule — read paths shouldn't write.
- **Bindings staleness post-incremental**: today `resolveBindings` runs full-rebuild only (`// Pass-2 binding resolution per R.12 — full-rebuild only`); my § 4.7 refactor preserves that boundary.

---

## 6. Suggested sequencing (tracer-bullet friendly)

Aligns with `.agents/rules/tracer-bullets.md` discipline — tiny end-to-end slices that each ship green:

1. **§ 4.3** — Add `bindings_ms` + `cycles_ms` + `re_export_chains_ms` to `IndexPerformanceReport`. Pure instrumentation, no behavior change. **Establishes guardrails before optimization** (per `docs/roadmap.md § Backlog`).
2. **§ 4.1** — `collectFiles` `ignore` + single-call refactor. Highest-leverage single change (~24% cold-build wall improvement). Validate via golden + diff on collected paths.
3. **§ 4.4 + § 4.8 + § 4.10 + § 4.11** — Low-risk micro-cleanups (path sort, adapter Map lookup, marker lineMap reuse, hash-map hoist). Each ships independently.
4. **§ 4.2** — `getChangedFilesWithSources` shape change. Touches the incremental orchestration; validate against existing watcher tests.
5. **§ 4.5** — Worker returns lineMap (builds on Composer 4.2). Bigger surface change; coordinate with their PR if both move forward.
6. **§ 4.7 + § 4.9 + § 4.12** — Bindings hoist, FTS5 batched delete, `stmtCache` placeholder pre-compute. Medium risk; gate on § 4.3 instrumentation showing measurable wins.
7. **§ 4.6** — IPC encoding spike. _Hypothesis-stage_ — only proceed if § 4.3 instrumentation shows IPC is a measurable fraction of `parse_ms`.

---

## 7. Cross-references (not duplications) with the Composer audit

| Composer item                                 | This audit            | Relationship                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| § 4.1 P1 (Benchmark CI)                       | § 6 sequencing step 1 | This audit makes the benchmark-CI prerequisite **concrete** by specifying the three new timer fields (`bindings_ms` / `cycles_ms` / `re_export_chains_ms`) and proving (with measured 167–178 ms) that today's report is missing 32% of the wall. |
| § 4.2 P1 (`countUtf8Lines` helper)            | § 4.5                 | Same root cause. This audit adds measurement (~7–12% of `parse_ms`) and clarifies it's TS/JS only — CSS / text paths legitimately need the inline scan.                                                                                           |
| § 4.3 P2 (Main-thread pipeline)               | § 4.6 _hypothesis_    | Adjacent; my IPC encoding spike narrows where the main-thread cost lives.                                                                                                                                                                         |
| § 4.4 P2 (Bindings allocations)               | § 4.7 + § 4.3         | This audit narrows the recommendation to "hoist the shared queries between `resolveBindings` and `resolveReExportChains`" and "instrument first, optimize second".                                                                                |
| § 4.5 P3 (Worker env cap)                     | —                     | Composer's recommendation stands. No duplication.                                                                                                                                                                                                 |
| § 4.6 P3 (Persistent read connection)         | —                     | Composer's recommendation stands. No duplication.                                                                                                                                                                                                 |
| § 4.7 P3 (`query_only` parity on `queryRows`) | § 4.13                | I echo Composer's finding.                                                                                                                                                                                                                        |
| § 4.8 P4 (`stmtCache` LRU)                    | § 4.12                | This audit narrows the growth-vector diagnosis: tail-batch placeholder variation, not user SQL.                                                                                                                                                   |

**Net new findings in this audit (no Composer overlap):**

- § 4.1 — `collectFiles` `ignore` + single-call refactor (highest-leverage; measured 12.8× speedup on glob).
- § 4.2 — Incremental path reads + hashes every changed file twice.
- § 4.3 — `--performance` is blind to bindings/cycles/re-exports (167–178 ms = 32%+ of wall).
- § 4.4 — `localeCompare` overkill for ASCII paths.
- § 4.8 — `getAdapterForExtension` linear scan.
- § 4.9 — FTS5 path-batched delete.
- § 4.10 — `extractMarkers` lineMap reuse on TS/JS.
- § 4.11 — `getAllFileHashes` hoist.

---

## 8. Appendix — verification commands

Re-runnable kit so a reviewer can reproduce every measurement above without trusting my numbers.

### Cold-build wall (this repo)

```bash
bun src/index.ts --full --performance
```

Expected (today): `collect: 215–255ms`, `parse: 145ms`, `insert: 138–141ms`, `index_create: 68ms`, `total_ms: 518–532ms`. Derive `bindings tail = total - parse - insert - index_create`.

### Glob-strategy micro-bench

```bash
bun -e "
const t0 = performance.now();
const {globSync} = require('tinyglobby');
const m = globSync(
  ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}','**/*.css','**/*.{md,mdx,mdc}','**/*.{json,yml,yaml}','**/*.sh'],
  {cwd: process.cwd(), dot: true, absolute: false, expandDirectories: false,
   ignore: ['**/node_modules/**','**/.git/**','**/dist/**','**/.codemap/**']}
);
console.log(m.length, (performance.now()-t0).toFixed(1)+'ms (1 call, with ignore)');
"
```

Expected: ~15 ms vs ~198 ms for the current 5-call no-ignore strategy.

### Table-counts (index state)

```bash
bun src/index.ts query --json 'SELECT
  (SELECT COUNT(*) FROM files) AS files,
  (SELECT COUNT(*) FROM symbols) AS symbols,
  (SELECT COUNT(*) FROM "references") AS refs,
  (SELECT COUNT(*) FROM bindings) AS bindings,
  (SELECT COUNT(*) FROM scopes) AS scopes,
  (SELECT COUNT(*) FROM calls) AS calls'
```

### Largest source files (hot paths)

```bash
bun src/index.ts query --json 'SELECT path, line_count FROM files ORDER BY line_count DESC LIMIT 20'
```

### Reference-count per file (binding-resolver load)

```bash
bun src/index.ts query --json 'SELECT file_path, COUNT(*) AS n FROM "references" GROUP BY file_path ORDER BY n DESC LIMIT 10'
```

### Binding resolution distribution

```bash
bun src/index.ts query --json 'SELECT resolution_kind, COUNT(*) AS n FROM bindings GROUP BY resolution_kind'
```

Expected today: `same-file` ~21k, `imported` ~8k, `global` ~2k, `unresolved` ~550.

---

_End of audit._
