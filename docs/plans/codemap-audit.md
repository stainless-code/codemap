# Plan — `codemap audit --base <ref>`

> Two-snapshot structural-drift verdict for a PR / branch. Adopted from [`docs/research/fallow.md` § Tier B B.5](../research/fallow.md) — explicitly the "single highest-leverage candidate" of that scan.

**Status:** Open — design pass; not yet implemented.
**Cross-refs:** [`docs/research/fallow.md`](../research/fallow.md) (motivation) · [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage) (where wiring lands) · [`.agents/lessons.md`](../../.agents/lessons.md) (changesets bump policy).

---

## 1. Goal

One command returns a structured verdict for what changed between a base ref and `HEAD`:

```text
codemap audit --base origin/main [--json] [--summary]
↓
{
  "verdict": "pass" | "warn" | "fail",
  "base": { "ref": "origin/main", "sha": "<sha>", "indexed_at": <ms> },
  "head": { "sha": "<sha>", "indexed_at": <ms> },
  "deltas": {
    "files":        { "added": [...], "removed": [...] },
    "dependencies": { "added": [...], "removed": [...] },
    "deprecated":   { "added": [...], "removed": [...] },
    "visibility":   { "added": [...], "removed": [...] },
    "barrels":      { "movements": [...] },
    "hot_files":    { "movements": [...] }
  }
}
```

Wraps existing recipes; doesn't grow a new analysis layer. Stays consistent with codemap's structural-index thesis ([`docs/why-codemap.md` § What Codemap is not](../why-codemap.md#what-codemap-is-not)).

## 2. Non-goals (v1)

- **Dead-code / duplication / complexity verdicts.** Those are fallow's territory and a non-goal per [`docs/roadmap.md` § Non-goals (v1)](../roadmap.md#non-goals-v1).
- **Code-quality scoring / grading.** No "code health 87/100" output.
- **Auto-fix / SARIF output.** Separate concerns — SARIF is B.8, auto-fix is explicitly out (D.14 in the research note).
- **Cross-repo audit** (audit `origin/main` of project A from a checkout of project B). Out of scope; reuse `--root` for the simpler "audit a different tree" case.
- **Continuous mode.** One-shot CLI, same as `codemap query`.

## 3. Snapshot strategy

The verdict is a diff between two indexed snapshots. Three credible architectures:

### Option A: Temp DB on the base ref (worktree-style)

```text
1. git worktree add /tmp/codemap-audit-<sha> <base-ref>
2. codemap --root /tmp/codemap-audit-<sha> --full   # builds .codemap.db there
3. Open both DBs, run delta queries cross-DB, emit verdict.
4. git worktree remove /tmp/codemap-audit-<sha>
```

**Pros:** Same code path as a normal index run on the base; no special "snapshot" abstraction; deltas are pure SQL across two attached DBs; reproducible regardless of how `HEAD` evolves.

**Cons:** Spawns a worktree + full reindex per audit (cold cost ~seconds for codemap-sized projects, more for large monorepos). Disk churn under `/tmp`.

### Option B: In-memory base via the existing `query_baselines` table (B.6 reuse)

```text
1. On main, periodically: for each "tracked" recipe, codemap query --save-baseline -r <id>.
2. On a PR branch: codemap audit --base <name> diffs the live query results against the saved snapshots.
```

**Pros:** Zero new infra — reuses B.6 directly. Snapshots are addressable / nameable. No cold reindex.

**Cons:** Requires baselines to be saved at the right moment (git-hook or CI step). Doesn't capture deltas the user didn't pre-baseline. Doesn't naturally express "deltas in the dependency graph as a whole" — only as far as recipes go.

### Option C: On-demand snapshot table for the audit (hybrid)

```text
1. codemap audit --base <ref> reads <ref> from git, computes audit-shaped queries against the
   *checked-out* tree at <ref> (using `git show <ref>:<file>` or `git archive` to materialise
   files in memory / a temp dir), populates a tiny in-DB `audit_snapshot` table with just the
   columns needed for the deltas (no full reindex).
2. Diff in SQL; drop the snapshot table.
```

**Pros:** No worktree spawn; no extra infra in main code paths; deltas are scoped to what the audit needs.

**Cons:** Implementing a "mini-indexer" that runs only the queries we need at <ref> is more code than (A) and the abstraction doesn't transfer.

### Recommendation

**Start with Option A** (temp worktree + full index). Reasons:

1. Simplest to implement correctly — no new abstractions; the existing `--full --root /tmp/...` path already works.
2. Cold cost on codemap (~150 files) is sub-second; on JordanCoin-sized projects (~few thousand files) still under 5s. Acceptable for "run on PR" usage.
3. Future optimisation: cache `<sha> → /tmp/codemap-audit-<sha>/.codemap.db` so repeated audits on the same base hit the cache.
4. Doesn't entangle the audit with B.6's user-facing baseline workflow (which has different semantics: user-named, hand-saved).

**Reconsider Option B** if Option A's perf becomes a problem AND audits are happening in tight loops (e.g. file-watch trigger).

## 4. Built-in deltas (v1)

Each delta wraps an existing query / recipe. All structural — no new analysis layer.

| Delta key      | What it surfaces                                                                                                                     | Source                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `files`        | New / deleted indexed files                                                                                                          | `SELECT path FROM files` (set diff)                                                                                        |
| `dependencies` | New / deleted edges in the file-to-file dependency graph                                                                             | `SELECT from_path, to_path FROM dependencies` (set diff)                                                                   |
| `deprecated`   | New / removed `@deprecated` symbols                                                                                                  | `--recipe deprecated-symbols` (set diff)                                                                                   |
| `visibility`   | New / removed visibility-tagged symbols (`@internal` / `@beta` / `@alpha` / `@private` — `@public` is the surface itself, not noise) | `SELECT name, kind, visibility, file_path FROM symbols WHERE visibility IS NOT NULL AND visibility != 'public'` (set diff) |
| `barrels`      | Files that crossed an export-count threshold (e.g. <10 → ≥10)                                                                        | `--recipe barrel-files` (compare top-N membership)                                                                         |
| `hot_files`    | Files that gained / lost rank in the fan-in or fan-out top-15                                                                        | `--recipe fan-in` / `--recipe fan-out` (compare top-N membership)                                                          |

**Out of v1** (reconsider once shipped):

- `cycles` — needs cycle detection on the dependency graph; not a recipe today
- `boundary_crossings` — needs a project-supplied glob list (similar to the future `audit-pr-architecture` skill kit); no canonical source
- `markers` — TODO/FIXME drift is noisy and project-specific
- `css_*` deltas — narrow audience; defer

## 5. Verdict shape

`pass | warn | fail` derived from per-delta thresholds. **Defaults exposed but conservative:**

| Delta | Default threshold                               |
| ----- | ----------------------------------------------- |
| any   | `pass` (thresholds are opt-in via config in v1) |

In other words: **v1 emits raw deltas only**. The verdict is always `pass` unless the user opts in via `codemap.config.*`. Reasoning: structural deltas don't have a universally-meaningful threshold ("how many new dependency edges is too many?" depends entirely on the project), and the research note explicitly biases toward "first pass exposes raw deltas only and lets the consumer set thresholds."

### Threshold config (v1.x)

Once per-project use surfaces concrete thresholds, fold into `codemap.config.*`:

```ts
// codemap.config.ts
export default defineConfig({
  audit: {
    deltas: {
      dependencies: { added_max: 50, action: "warn" },
      deprecated: { added_max: 0, action: "fail" }, // any new @deprecated fails
      visibility: { added_max: 5, action: "warn" },
    },
    // verdict reduction: highest action wins (fail > warn > pass)
  },
});
```

Validated via existing `codemapUserConfigSchema` (Zod) — see [`docs/architecture.md` § User config](../architecture.md#user-config). Schema additions are minor changesets per [`.agents/lessons.md` "changesets bump policy"](../../.agents/lessons.md) (no `.codemap.db` impact).

## 6. Composition with existing flags

| Flag                             | Behaviour with `audit`                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--json`                         | Default for the verdict shape; non-JSON falls back to `console.table` per delta + a one-line verdict summary.      |
| `--summary`                      | Collapses every delta to `{added: N, removed: N}`; verdict + base/head metadata stay. Useful for CI status checks. |
| `--changed-since`                | **Mutex** — `audit` is itself a "changed-since" operation; combining would be confusing. Parser-level error.       |
| `--group-by`                     | **Mutex** — verdict shape is already structured; bucketing is the consumer's job on the output JSON.               |
| `--save-baseline` / `--baseline` | **Mutex** — different snapshot semantics (B.6 is user-named; audit is base-ref-driven).                            |
| `--recipe`                       | N/A — `audit` isn't a `query` subcommand; it's its own top-level command.                                          |

## 7. CLI surface

```text
codemap audit --base <ref> [--json] [--summary] [--root <dir>] [--config <file>]
```

- `--base <ref>` — required. Any committish (`origin/main`, `HEAD~5`, sha, tag).
- `--root` / `--config` / `--help` / `-h` — same shape as the rest of the CLI (handled by `bootstrap`).
- Exit codes: **0** on `pass`, **1** on `warn`, **2** on `fail`. (CI-friendly; mirrors `git diff --exit-code`.)

## 8. Tracer-bullet sequence

Per [`.agents/rules/tracer-bullets`](../../.agents/rules/tracer-bullets.md), commit each slice end-to-end:

1. **CLI scaffold** — `codemap audit --help` works; `--base <ref>` parsed; `runAuditCmd` calls a stub that returns `{verdict: "pass", deltas: {}}`. Smoke + commit.
2. **Worktree + base index** — Option A spawn-and-index implementation; assert two `.codemap.db` files exist. Commit.
3. **First delta — `files`** — minimal end-to-end vertical slice: open both DBs, set-diff `path`, emit `{files: {added, removed}}`. Smoke + commit.
4. **Remaining deltas** — `dependencies`, `deprecated`, `visibility`, `barrels`, `hot_files` — each as a separate commit so individual tests can be reviewed.
5. **Threshold config** — Zod schema additions + verdict reduction; default `pass` until user opts in. Commit.
6. **Docs + agents update** — `architecture.md § Audit wiring`, glossary entry, README CLI block, rule + skill across `.agents/` and `templates/agents/` (Rule 10). Commit.
7. **Changeset** — patch (no schema bump). Commit.

Estimated total: 1–2 days end-to-end across ~7 commits.

## 9. Open questions

- **Should the temp worktree live under `.codemap/audit-<sha>/` (project-local) or `/tmp/codemap-audit-<sha>` (system temp)?** Project-local is gitignorable via the existing `.codemap.*` glob (works only if the dir is named `.codemap.audit-<sha>`); system temp is auto-cleaned but loses the cache benefit across reboots. **Lean: project-local, naming `.codemap.audit-<sha>` so the existing gitignore covers it.**
- **Should `audit` warn when `<base>` and `HEAD` are identical?** Almost certainly user error (probably wanted `--base origin/main` not `--base HEAD`). Surface a warning, exit 0 with empty deltas.
- **Should the verdict include `actions` per delta key?** Recipe `actions` (Tier A.1) attach to row sets; an audit delta is a higher-level concept. v1 punts; v1.x can add `audit.actions: { dependencies: "review-coupling-spike" }` if patterns emerge.
- **Cross-snapshot performance ceiling.** At what project size does Option A become unacceptable (>30s)? Need a benchmark fixture; defer until a real consumer hits the wall.

## 10. References

- Motivation: [`docs/research/fallow.md` § Tier B B.5](../research/fallow.md) ("single highest-leverage candidate").
- Snapshot primitive prior art: PR #30 — `query_baselines` table + `--save-baseline` / `--baseline`.
- Composition: PR #26 — Tier A flags (`--summary` / `--changed-since` / `--group-by` / per-row `actions`).
- Visibility column prior art: PR #28 — `symbols.visibility` (B.7).
- CLI conventions: [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage).
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
