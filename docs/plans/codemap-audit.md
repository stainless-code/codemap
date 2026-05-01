# Plan — `codemap audit`

> Two-snapshot structural-drift verdict for a PR / branch. **v1 ships `--baseline <name>`** (diff against a B.6 saved baseline); **v1.x adds `--base <ref>`** (worktree+reindex). Adopted from [`docs/research/fallow.md` § Tier B B.5](../research/fallow.md) — explicitly the "single highest-leverage candidate" of that scan.

**Status:** Open — design pass; not yet implemented.
**Cross-refs:** [`docs/research/fallow.md`](../research/fallow.md) (motivation) · [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage) (where wiring lands) · [`.agents/lessons.md`](../../.agents/lessons.md) (changesets bump policy).

---

## 1. Goal

One command returns the structural deltas between a saved snapshot (or a git ref) and the current `HEAD` index:

```text
codemap audit --baseline <name>     # diff vs a B.6-style saved baseline (v1)
codemap audit --base <ref>          # diff vs a worktree+reindex of <ref> (v1.x)
↓
{
  "base": { "source": "baseline" | "ref", "name": "...", "sha": "...", "indexed_at": <ms> },
  "head": { "sha": "<sha>", "indexed_at": <ms> },
  "deltas": {
    "files":        { "added": [...], "removed": [...] },
    "dependencies": { "added": [...], "removed": [...] },
    "deprecated":   { "added": [...], "removed": [...] }
  }
}
```

**v1 ships raw deltas only** — no `verdict` field, exit 0 on success regardless of delta size. A native verdict (`pass | warn | fail` with `codemap.config.audit` thresholds) is a v1.x slice; until then, consumers compose `--json` + `jq` for CI exit codes (one-liner). Rationale in [§5 Verdict shape](#5-verdict-shape).

**v1 auto-runs an incremental index before every audit** so `head` reflects the current source tree. `--no-index` opts out (audit a frozen DB). Rationale in [§7 CLI surface](#7-cli-surface).

Wraps existing recipes; doesn't grow a new analysis layer. Stays consistent with codemap's structural-index thesis ([`docs/why-codemap.md` § What Codemap is not](../why-codemap.md#what-codemap-is-not)).

## 2. Non-goals (v1)

- **Dead-code / duplication / complexity verdicts.** Those are fallow's territory and a non-goal per [`docs/roadmap.md` § Non-goals (v1)](../roadmap.md#non-goals-v1).
- **Code-quality scoring / grading.** No "code health 87/100" output.
- **Auto-fix / SARIF output.** Separate concerns — SARIF is B.8, auto-fix is explicitly out (D.14 in the research note).
- **Cross-repo audit** (audit `origin/main` of project A from a checkout of project B). Out of scope; reuse `--root` for the simpler "audit a different tree" case.
- **Continuous mode.** One-shot CLI, same as `codemap query`.

## 3. Snapshot strategy — two modes, ship Option B first

The verdict is a diff between two indexed snapshots. There are two valid sources for the "before" snapshot, and they solve subtly different problems — **so codemap audit ships both modes** (mutex, pick one per invocation).

| Mode                     | Best at                                                                                                                                                                                                                 | CLI                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **B — baseline reuse**   | "What's drifted vs a snapshot I deliberately took **then**" — fast, no cold reindex, reproducible because the snapshot is frozen in `.codemap.db`                                                                       | `codemap audit --baseline <name>` |
| **A — worktree+reindex** | "What's drifted vs an arbitrary ref I name **now**" — no pre-baseline needed, but spawns a worktree + full reindex per audit, and is sensitive to clone staleness (`origin/main` may be hours behind the actual remote) | `codemap audit --base <ref>`      |

### Decision: ship **Option B first** (v1), Option A in v1.x

Reasons:

1. **Cheaper to ship.** Option B reuses the B.6 `query_baselines` table verbatim — no worktree code, no cold-reindex perf concern, no `git fetch` staleness handling.
2. **Most acute pain is delta-against-saved-state.** Real workflow: `codemap query --save-baseline -r <recipe>` on `main` → branch → refactor → `codemap audit --baseline <recipe>`. This is what B.6 was built for; audit just collapses recipe-by-recipe baselines into one verdict.
3. **`--base <ref>` is genuinely a different shape.** It needs a fetch-or-fail prelude, a worktree spawn, a temp `.codemap.db` build, and cleanup. Each adds CLI surface and bug surface; deferring lets us validate the verdict / threshold / delta shape under B before committing to the worktree path.
4. **Cache benefit of Option A only matters at scale.** Codemap-sized projects index in sub-second; the cache benefit of `<sha> → /tmp/codemap-audit-<sha>/.codemap.db` only pays back on multi-thousand-file repos. Defer until a real consumer hits it.

### Option C: dropped

Earlier draft included a third "on-demand snapshot table" hybrid. Killed during planning: it's a mini-indexer that doesn't transfer to other use cases and adds the code-volume of Option A without its conceptual simplicity. Re-revisit only if both A and B prove insufficient.

### v1 `--baseline` mechanics

- The baseline must already exist in `query_baselines` (saved by `codemap query --save-baseline`). If not, exit 1 with `codemap: no baseline named "<name>". Use --baselines to list.` (same error shape as `codemap query --baseline`).
- Audit doesn't introduce its own baseline-save side effect — the user explicitly opts in via `--save-baseline`. Single source of truth for "snapshot lives here" stays the B.6 surface.
- The verdict's `base.source` is `"baseline"`; `base.name` is the baseline name; `base.sha` is the baseline's recorded `git_ref`; `base.indexed_at` is the baseline's `created_at`.

### v1.x `--base <ref>` mechanics (when shipped later)

- Spawn a worktree under `.codemap.audit-<sha>/` (gitignored by the existing `.codemap.*` glob).
- `codemap --full --root .codemap.audit-<sha>` builds the temp DB.
- Diff queries run cross-DB; results pasted into the same verdict shape with `base.source = "ref"`.
- Cleanup removes the worktree (cache decision deferred — see open questions §9).
- `--base` and `--baseline` are mutex (one snapshot source per invocation).

## 4. Built-in deltas (v1)

Each delta wraps an existing query / recipe. All structural — no new analysis layer. **v1 ships three deltas only**; the rest are deferred (each carries an explicit trigger so we don't re-litigate from scratch).

| Delta key      | What it surfaces                                         | Baseline source contract                                                                              |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `files`        | New / deleted indexed files                              | Baseline must come from `SELECT path FROM files` (or `--recipe files-hashes` — same `path` column).   |
| `dependencies` | New / deleted edges in the file-to-file dependency graph | Baseline must come from `SELECT from_path, to_path FROM dependencies` (no `DISTINCT` — composite PK). |
| `deprecated`   | New / removed `@deprecated` symbols                      | Baseline must come from `--recipe deprecated-symbols`.                                                |

### Delta function shape

Each delta defines its own **canonical projection** (a fixed `SELECT … ORDER BY …`) and runs that projection on both sides of the diff. The baseline's stored `sql` is informational — **not replayed**. This isolates the audit from underlying-table schema drift (e.g. SCHEMA_VERSION 4 → 5 added `symbols.visibility`; baselines saved before the bump must still diff cleanly).

Per-delta canonical projection:

| Delta          | Canonical SQL (run on both baseline-projection AND current DB)                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `files`        | `SELECT path FROM files ORDER BY path`                                                                      |
| `dependencies` | `SELECT from_path, to_path FROM dependencies ORDER BY from_path, to_path`                                   |
| `deprecated`   | `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%' ORDER BY file_path, name` |

Each delta function:

1. Loads the named baseline via `getQueryBaseline(db, name)` (B.6 helper from `db.ts`).
2. Parses `rows_json` to row objects.
3. **Validates baseline column-set membership.** The delta's canonical projection has a fixed required-columns list (e.g. `dependencies` requires `from_path`, `to_path`). If any required column is missing from the baseline rows, surface a clean error:

   ```
   codemap audit: baseline "<name>" is missing required columns
   for delta "<delta-key>": got [<actual>], need [<required>].
   Re-save with: codemap query --save-baseline=<name> -r <recipe>
   ```

4. **Projects baseline rows** to the canonical column subset (extra columns are dropped — agents can still inspect the full baseline via `codemap query --baselines`).
5. Runs the canonical SQL against the current DB.
6. Set-diffs via the existing `diffRows` helper from `cmd-query.ts` (multiset, identity = canonical `JSON.stringify(row)` over the projected columns).
7. Returns `{added: [...], removed: [...]}` — projected rows only.

This means a baseline saved from `--recipe deprecated-symbols` (which returns 6 columns) and a baseline saved from a leaner ad-hoc `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%'` both work — as long as the required column set is satisfied. Schema bumps that add columns also keep working — the projection drops the new columns. Schema bumps that remove a required column would break the delta — that's the intended behaviour (the delta's contract has changed).

### Deferred — add later when needed

| Delta                | Why deferred (v1)                                                                                                                                                         | Trigger to revisit                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `visibility`         | Already covered by `codemap query --baseline visibility-tags` from B.6 directly; v1 audit doesn't add much on top.                                                        | A consumer wants visibility deltas in the same JSON envelope as `files` / `dependencies`.     |
| `barrels`            | "Top-N membership change" has fuzzy threshold semantics ("rank movement" vs "joined / left top-20"). Defer until a clear semantic emerges from real use.                  | Two consumers ask for "this file just became a barrel" as a verdict-shaping signal.           |
| `hot_files`          | Same fuzzy-threshold problem as `barrels` (fan-in / fan-out top-N movement).                                                                                              | Same.                                                                                         |
| `cycles`             | Needs cycle detection on `dependencies`; not a recipe today.                                                                                                              | Cycle detection lands as a recipe (or PRAGMA-driven SQL); audit consumes it.                  |
| `boundary_crossings` | Needs a project-supplied glob list (the [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md) skill's § 2 territory); no canonical source today. | The `audit-pr-architecture` skill formalises a per-repo "boundaries" config codemap can read. |
| `markers`            | TODO / FIXME drift is noisy and project-specific.                                                                                                                         | A consumer asks for it explicitly.                                                            |
| `css_*` deltas       | Narrow audience.                                                                                                                                                          | Same.                                                                                         |

**Adding a delta later is mechanical** (one delta function + one threshold-config field + one test + one doc note). **Removing one is harder** (consumer config has thresholds for it; removing breaks user setups). Defer-by-default.

## 5. Verdict shape

**v1 ships no `verdict` field.** Exit 0 on success regardless of delta size. The output envelope is `{base, head, deltas}` — adding `verdict` later is purely additive and forward-compatible.

### Why no verdict in v1

1. **Honesty about what we know.** Structural deltas don't have a universally-meaningful threshold ("how many new dependency edges is too many?" depends entirely on the project). Inventing defaults or shipping a placeholder both pretend we do.
2. **Real consumers shape the config, not me guessing.** When two consumers ship `jq`-based CI scripts with similar threshold shapes, that pattern becomes the v1.x schema. Until then, no schema commitment.
3. **fallow already covers the code-quality verdict use case.** A consumer who wants `pass/warn/fail` on dead code, dupes, or complexity runs `fallow audit --base origin/main` — that's fallow's product class ([`docs/roadmap.md` § Non-goals](../roadmap.md#non-goals-v1)). Codemap audit's job is the **structural-delta** signal fallow can't see (new dependency edges, new files, new `@deprecated` drift).
4. **Cheap consumer-side bridge.** `codemap audit --baseline X --json | jq -e '.deltas.dependencies.added | length <= 50'` exits 1 when the threshold trips. CI-driven thresholds work today without codemap shipping the verdict.

### v1.x trigger to revisit

Add the native verdict + threshold config when **either** of:

- Two consumers independently ship `jq`-based threshold scripts with similar shapes (the pattern crystallises the config schema).
- One consumer asks for native thresholds with a concrete config sketch.

### Sketch (informational, not v1 commitment)

When the trigger fires, the shape will likely look like:

```ts
// codemap.config.ts (v1.x — NOT shipped in v1)
export default defineConfig({
  audit: {
    deltas: {
      dependencies: { added_max: 50, action: "warn" },
      deprecated: { added_max: 0, action: "fail" }, // any new @deprecated fails
    },
    // verdict reduction: highest action wins (fail > warn > pass)
  },
});
```

Validated via existing `codemapUserConfigSchema` (Zod) — see [`docs/architecture.md` § User config](../architecture.md#user-config). Schema additions are minor changesets per [`.agents/lessons.md` "changesets bump policy"](../../.agents/lessons.md) (no `.codemap.db` impact). Exit codes 0/1/2 ship together with `verdict` — never half-shipped.

## 6. Composition with existing flags

| Flag                | Behaviour with `audit`                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`            | Emits the `{base, head, deltas}` envelope. See [§7.1 Output shapes](#71-output-shapes) for the terminal-mode (no `--json`) layout.                                                     |
| `--summary`         | Collapses every delta in the output to counts: with `--json` → `deltas.<key>.{added: N, removed: N}`; without → a single line. See [§7.1](#71-output-shapes).                          |
| `--baseline <name>` | **Snapshot source** — diff against the named B.6 baseline. v1 default mode.                                                                                                            |
| `--base <ref>`      | **Snapshot source** — diff against a worktree+reindex of `<ref>`. v1.x. **Mutex with `--baseline`** (one snapshot source per invocation).                                              |
| `--save-baseline`   | **N/A** — audit doesn't save baselines. Use `codemap query --save-baseline -r <recipe>` first, then `codemap audit --baseline <name>`. Single source of truth for snapshots stays B.6. |
| `--changed-since`   | **Mutex** — `audit` is itself a "changed-since" operation; combining would be confusing.                                                                                               |
| `--group-by`        | **Mutex** — output shape is already structured; bucketing is the consumer's job on the output JSON.                                                                                    |
| `--no-index`        | **Skip the auto-incremental-index prelude.** Default is to re-index first so `head` is fresh; `--no-index` audits the DB as-is.                                                        |
| `--recipe`          | N/A — `audit` isn't a `query` subcommand. The v1 deltas internally pin canonical SQL (per §4) — not user-selectable.                                                                   |

## 7. CLI surface

```text
# v1 (ships first):
codemap audit --baseline <name> [--json] [--summary] [--no-index] [--root <dir>] [--config <file>]

# v1.x (ships after v1 validates the delta shape):
codemap audit --base <ref>      [--json] [--summary] [--no-index] [--root <dir>] [--config <file>]
```

- `--baseline <name>` — v1. Required (or `--base <ref>` once shipped). Name must exist in `query_baselines`; saved by `codemap query --save-baseline`.
- `--base <ref>` — v1.x. Any committish (`origin/main`, `HEAD~5`, sha, tag).
- **`--baseline` and `--base` are mutex** — exactly one snapshot source per invocation.
- `--no-index` — skip the auto-incremental-index prelude (see below). Default audits a fresh `head` snapshot.
- `--root` / `--config` / `--help` / `-h` — same shape as the rest of the CLI (handled by `bootstrap`).
- **Exit codes (v1):** `0` on success, `1` on bootstrap / DB / baseline-not-found errors. No verdict-driven exit codes until v1.x ships `verdict`.

### Auto-incremental-index prelude

Before computing deltas, `runAuditCmd` calls `runCodemapIndex({ mode: "incremental" })` (the same code path as a bare `codemap` invocation). Reasons:

1. **Same discipline as the codemap rule.** Agents are already told "After completing a step that modified source files, re-index before making any further queries." The audit is a query consumer; auto-indexing treats it the same way.
2. **Cheap when there's nothing to do.** Incremental indexing is sub-second when no source has changed since last index — git-diff narrows the set to zero.
3. **Avoids silent staleness.** Without the prelude, an agent that runs `audit` after editing source but before re-indexing would get a `head` snapshot that's older than the changes it just made. The deltas would lie.
4. **`--no-index` escape hatch** for the rare case of "audit a frozen DB without touching files" (e.g. CI fetches a pre-built `.codemap.db` artifact and just wants the diff).

The prelude reuses `runCodemapIndex` from `application/run-index.ts` — no new code for the indexing step itself, just a single-call wrapper in `cmd-audit.ts`.

### 7.1 Output shapes

Mirrors `git status` — terse on the common (no-drift) case, expressive when there's actual signal. Three output modes from the same data:

**Terminal mode (no `--json`), no drift:**

```text
audit "pre-refactor" (saved 2 days ago @ abc1234, 152 rows)
  → no drift across files / dependencies / deprecated.
```

**Terminal mode (no `--json`), with drift:**

```text
audit "pre-refactor" (saved 2 days ago @ abc1234, 152 rows)
  → drift: files +1/-0, dependencies +3/-2, deprecated +1/-0

  files (+1):
    ┌─────────┬──────────────────────────┐
    │ (index) │ path                     │
    ├─────────┼──────────────────────────┤
    │ 0       │ src/cli/cmd-audit.ts     │
    └─────────┴──────────────────────────┘

  dependencies (+3 / -2):
    [console.table here]

  deprecated (+1):
    [console.table here]
```

`console.table` blocks are emitted **only for deltas with rows** — empty deltas don't print a `(no results)` placeholder (would be three of them in the no-drift case, all noise).

**`--summary` (no `--json`):**

```text
audit "pre-refactor" (saved 2 days ago @ abc1234, 152 rows)
  → drift: files +1/-0, dependencies +3/-2, deprecated +1/-0
```

Same one-line summary as terminal mode's drift header — no per-delta tables.

**`--summary --json`:**

```json
{
  "base": {
    "source": "baseline",
    "name": "pre-refactor",
    "sha": "abc1234",
    "indexed_at": 1714557600000
  },
  "head": { "sha": "def5678", "indexed_at": 1714560000000 },
  "deltas": {
    "files": { "added": 1, "removed": 0 },
    "dependencies": { "added": 3, "removed": 2 },
    "deprecated": { "added": 1, "removed": 0 }
  }
}
```

Counts replace the row arrays; envelope is otherwise identical to the full `--json` shape.

## 8. Tracer-bullet sequence

Per [`.agents/rules/tracer-bullets`](../../.agents/rules/tracer-bullets.md), commit each slice end-to-end. **v1 ships only `--baseline <name>` (Option B).** `--base <ref>` (Option A) ships in a separate v1.x PR.

### File layout

The audit splits along codemap's existing `cli/` ↔ `application/` seam — same shape as `cmd-index.ts` ↔ `application/index-engine.ts`:

| File                                   | Responsibility                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/cmd-audit.ts`                 | argv parse (`--baseline`, `--json`, `--summary`), delegation to `runAudit`, terminal-mode renderer (per §7.1).                                                                                                         |
| `src/application/audit-engine.ts`      | Delta registry (key → canonical SQL + required columns), baseline column-set validation, per-delta diff functions, the `{base, head, deltas}` envelope assembly. Exported entry point: `runAudit({db, baselineName})`. |
| `src/cli/cmd-audit.test.ts`            | argv → option-bag tests (parser shape, mutex errors, etc.).                                                                                                                                                            |
| `src/application/audit-engine.test.ts` | Engine tests — exercise `runAudit` against in-memory DB + canned baselines; assert envelope shape and the column-set-validation error path.                                                                            |

The split:

- **Mirrors existing layering** (`cli/cmd-index.ts` ↔ `application/index-engine.ts`) — architectural consistency.
- **Makes the engine testable independent of CLI shape** — `audit-engine.test.ts` doesn't care about argv.
- **Makes the v1.x `--base <ref>` slice mechanical** — worktree+reindex code lives in `cmd-audit.ts` (CLI orchestration); the engine just gets a different `db` handle pointing at the temp DB.
- **Forward-compatible with a programmatic `Codemap.audit()` method** if `api.ts` ever exposes it.

### v1 tracer-bullet sequence — `--baseline <name>`

1. **CLI scaffold** — `cmd-audit.ts` + `audit-engine.ts` skeletons. `codemap audit --help` works; `--baseline <name>` and `--no-index` parsed; auto-incremental-index prelude wired (calls `runCodemapIndex({ mode: "incremental" })` unless `--no-index`); `runAudit` returns `{base: {source: "baseline", ...}, head: {...}, deltas: {}}` stub. Smoke + commit.
2. **Delta registry + first delta — `files`** — engine grows the canonical-projection registry (`{key, sql, requiredColumns}`); `files` delta implements load-baseline → validate-columns → project → diff via `diffRows`. CLI renders one terminal-mode block. Commit.
3. **Remaining deltas** — `dependencies`, `deprecated` — each as a separate commit. Each adds one registry entry + one delta function + tests. Renderer extends naturally.
4. **Terminal-mode polish** — implement the no-drift / drift / `--summary` output shapes from §7.1; `cmd-audit.test.ts` covers all three.
5. **Docs + agents update** — `architecture.md § Audit wiring`, glossary entry, README CLI block, rule + skill across `.agents/` and `templates/agents/` (Rule 10). Commit.
6. **Changeset** — patch (no schema bump; reuses existing `query_baselines` table). Commit.

Estimated total: ~1 day end-to-end across ~6 commits. The threshold-config / verdict step is **explicitly out** of v1 (see §5).

### v1.x — `--base <ref>` (separate PR)

1. Worktree spawn + temp-DB build (`codemap --full --root .codemap.audit-<sha>`).
2. Cross-DB delta queries (same delta definitions as v1, swap snapshot source).
3. Cleanup + cache decision (see open question §9).
4. Docs + Rule 10 update.
5. Changeset.

Defers until: (a) v1 validates the delta shape under real use, AND (b) at least one consumer asks for "audit against an arbitrary ref I haven't pre-baselined."

### v1.x — `verdict` + threshold config (separate PR, separate trigger)

Independent slice from `--base <ref>`. Triggers and shape sketched in [§5 Verdict shape](#5-verdict-shape).

## 9. Open questions (v1.x)

These all defer to v1.x or later — none block the v1 ship.

- **Worktree location for `--base <ref>`** — `.codemap.audit-<sha>/` (project-local; gitignored by the existing `.codemap.*` glob) vs `/tmp/codemap-audit-<sha>` (system-temp; auto-cleaned but loses cache across reboots). **Lean: project-local, named to match the gitignore.** Settled when v1.x ships.
- **`actions` per delta key** — recipe `actions` (Tier A.1) attach to row sets; an audit delta is a higher-level concept. v1 doesn't include `actions` at all (no verdict either — see §5). v1.x can add `audit.actions: { dependencies: "review-coupling-spike" }` if patterns emerge.
- **Cross-snapshot performance ceiling for `--base <ref>`** — at what project size does the worktree+full-reindex path become unacceptable (>30s)? Needs a benchmark fixture; defer until a real consumer hits the wall.

### Settled during the design pass

- **Should `audit` warn when `<base>` and `HEAD` are identical?** **No.** The renderer's metadata header (`baseline "X" (saved 2 days ago @ abc1234, 152 rows)`) already exposes the baseline's `git_ref`; the user can spot a same-SHA mistake from the existing output. Adding a warning would be noise in the common case (zero deltas after a small change is exactly what you want) and heuristic-driven in the edge cases ("divergent baseline" requires merge-base inspection — meaningful code for a low-signal warning). Reconsider only if a real consumer reports losing time to it.

## 10. References

- Motivation: [`docs/research/fallow.md` § Tier B B.5](../research/fallow.md) ("single highest-leverage candidate").
- Snapshot primitive prior art: PR #30 — `query_baselines` table + `--save-baseline` / `--baseline`.
- Composition: PR #26 — Tier A flags (`--summary` / `--changed-since` / `--group-by` / per-row `actions`).
- Visibility column prior art: PR #28 — `symbols.visibility` (B.7).
- CLI conventions: [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage).
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
