# `codemap apply <recipe-id>` — plan

> **Status:** open · plan iterating. M effort. Substrate-shaped fix engine; consumes the existing `--format diff-json` row contract from any recipe (rename-preview ships as the exemplar).
>
> **Motivator:** today the `--format diff` / `--format diff-json` formatters EMIT a unified diff or structured hunks, but they're read-only previews — codemap never writes files. `codemap apply <recipe-id>` closes that loop: the consumer's recipe SQL describes a transformation as `{file_path, line_start, before_pattern, after_pattern}` rows; `apply` re-validates each row against current disk state and applies the hunks as actual edits. Substrate, not verdict — the recipe IS the SQL; codemap is the executor.
>
> **Tier:** M effort (~1 week). No new schema. No new engines for the heavy lifting (formatter logic is shared with `--format diff`). Conflict detection (`before_pattern` re-validation) reuses existing `formatDiffJson` plumbing. New surface is the verb itself + per-file write path + dry-run / conflict-resolution UX.

---

## Pre-locked decisions

These are committed to v1 (lifted from the [`roadmap.md § Backlog`](../roadmap.md#backlog) entry). Questions opened against them must justify against the linked floors / moats.

| #   | Decision                                                                                                                                                                                                                                                                                                                                       | Source                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| L.1 | **Substrate, not verdict — Moat-A clean.** The recipe's SQL defines the transformation; `apply` is the executor. Reviewer test: "is this also expressible as `query --recipe X --format diff-json`?" — yes by construction (the rows are the same).                                                                                            | [Moat A](../roadmap.md#moats-load-bearing)                                      |
| L.2 | **Reuses the existing `--format diff-json` row contract.** Required columns: `{file_path, line_start, before_pattern, after_pattern}`. New `apply` engine consumes the same `DiffJsonPayload` shape `formatDiffJson` emits. No schema additions, no new SQL primitives.                                                                        | `application/output-formatters.ts` `DiffOpts` / `DiffJsonPayload`               |
| L.3 | **Conflict detection re-validates `before_pattern` against current disk state.** Mirrors what `formatDiff` already does at format-time (per the existing `stale` / `missing` flags); `apply` upgrades the soft warning into a hard rejection of the conflicting hunk.                                                                          | `formatDiff` + `formatDiffJson` precedent                                       |
| L.4 | **Floor "No fix engine" preserved.** `apply` does NOT synthesise edits — it only executes the hunks the SQL row described. No semantic refactoring, no AST rewriting beyond what the recipe's `before_pattern` / `after_pattern` describe textually.                                                                                           | [Floor "No fix engine"](../roadmap.md#floors-v1-product-shape)                  |
| L.5 | **Default-safe — destructive action behind explicit opt-in.** Exact shape (dry-run-by-default vs `--yes` confirmation vs both) resolved by Q1 / Q6 below.                                                                                                                                                                                      | Project posture; matches `codemap audit` / `codemap query` v1 read-only default |
| L.6 | **Failure-mode isolation, write-side semantics.** Partial-apply behavior (transactional shape) is a deliberate v1 decision — Q2 resolves the exact contract.                                                                                                                                                                                   | New design surface                                                              |
| L.7 | **Read-side primitives unchanged.** `--format diff` and `--format diff-json` remain read-only previews — no behavior change to consumers that already pipe `query --recipe X --format diff` to a viewer. `apply` is a separate verb with its own write surface.                                                                                | Backwards-compat                                                                |
| L.8 | **Input source is recipe execution (live), not stdin or a file.** `apply` runs the recipe through the same engine `query --recipe X --format diff-json` does (with `--params`), then consumes the rows directly. Out of scope for v1: `apply --from <file.json>` (revisit if a CI pipeline needs to apply a captured payload — easy additive). | Simplification — keeps the moat-A "recipe IS the SQL" framing intact            |
| L.9 | **No `codemap apply` SARIF / annotations output.** Apply emits a structured success/failure envelope (Q5); SARIF is for findings, not write actions.                                                                                                                                                                                           | Output-formatter scope                                                          |

---

## Open decisions (iterate as the plan converges)

Each gets a "Resolution" subsection below as it crystallises (mirrors the recipe-recency pattern).

- **Q1 — Default mode: dry-run-by-default vs apply-by-default vs both-with-flag.** Three shapes:
  - **(a) Dry-run by default; `--apply` flag opts into writing.** Conservative — `codemap apply <id>` previews; `codemap apply --apply <id>` writes. Trade-off: the verb name "apply" preceding a non-applying default is confusing; users shell-history-replay an apply command and get unexpected dry-run output.
  - **(b) Apply by default; `--dry-run` flag opts into preview.** Conventional — matches `npm install`, `git apply`, `terraform apply`. Pairs with Q6's confirmation gate as the safety net (no need for double-flagging).
  - **(c) No default — require explicit `--apply` OR `--dry-run`.** Force-the-decision. Verbose; doesn't pair well with bash agent invocations.

  ### Q1 Resolution

  **Locked: (b) Apply by default; `--dry-run` opts into preview.**

  Reasoning:
  - **Verb-name semantics.** A user typing `codemap apply X` and getting a dry-run is surprising. Ecosystem precedent (`npm install`, `git apply`, `terraform apply`, `cargo install`) all default to applying.
  - **Pairs cleanly with Q6's confirmation gate.** Safety lives in the gate (TTY prompt + `--yes` for non-TTY), not in a double-protect default.
  - **Reject (c).** Codemap has 2 modes (apply / preview); forcing both flags is friction without payoff.
  - **Moat-A:** apply is a substrate verb — the recipe SQL is the synthesis surface. Defaulting to dry-run would imply codemap is making a safety judgment about the recipe; defaulting to apply puts the safety in the gate.

- **Q2 — Transactional shape: all-or-nothing scope.** When the recipe emits hunks across N files and one file conflicts (per L.3), what happens to the others?
  - **(a) Per-row** — each hunk applied independently; conflicts skip just that hunk.
  - **(b) Per-file** — all hunks for a file apply together or none do.
  - **(c) Per-recipe-run** — all-or-nothing across the entire row set.
  - **(d) User-selected** — flag like `--mode={per-row, per-file, per-recipe}`.

  ### Q2 Resolution

  **Locked: (c) Per-recipe-run, all-or-nothing.**

  Reasoning:
  - **Cross-file invariants matter for the value-add case.** `rename-preview` produces a definition row in file A + import rows in files B/C. (a) leaves files syntactically broken (half-renamed identifier sets). (b) keeps each file syntactic in isolation but breaks cross-file references (B/C importing a name that no longer exists in A). Only (c) preserves project-level consistency.
  - **Two-phase implementation, no rollback machinery.** Validate-all-rows-first against current disk → if any conflict, abort with full report → otherwise write-all. The TOCTOU window between validate and write is negligible (apply isn't adversarial).
  - **Re-run model.** Fix the conflict, re-run; the recipe re-executes against the now-fresh index and produces a clean row set. (c)'s "abort and report" naturally flows into that loop.
  - **`git apply` precedent.** Default all-or-nothing; `--reject` opts into per-row partial. Codemap mirrors with a future `--allow-partial` flag if demand emerges.
  - **(d) over-engineered for v1.** Demand can drive a `--allow-partial` toggle later; v1 ships one safe default.

- **Q3 — Conflict-failure shape (collapsed by Q2 (c)).** Q2's all-or-nothing makes the original "skip-with-warning" path incoherent (no skip when the unit is the whole run). Reduces to "what does the failure report carry?":
  - **(a) Fail-fast** — abort on first conflict; report just that one.
  - **(b) Scan-and-collect** — phase-1 validation walks ALL rows, collects every conflict, then aborts with a full report.
  - **(c) Auto-reindex-and-retry** — when conflict suggests staleness, re-run the recipe with a fresh index and retry once.

  ### Q3 Resolution

  **Locked: (b) Scan-and-collect.**

  Reasoning:
  - **Free under Q2's two-phase implementation.** Phase 1 already walks every row; collecting all conflicts is the same cost as collecting the first.
  - **Better remediation UX.** Full conflict list lets the user fix everything in one pass before retrying; (a) fail-fast forces N retry cycles for N conflicts.
  - **Reject (c) auto-reindex.** Masks the staleness signal — if the index is stale, the right user-action is `codemap` then retry, not silent self-healing. Promotion gated on recurring pain.

  **Output shape** (extends Q5's envelope):

  ```json
  {
    "applied": false,
    "conflicts": [
      {
        "file_path": "...",
        "line_start": 42,
        "before_pattern": "...",
        "actual_at_line": "...",
        "reason": "line content drifted"
      }
    ],
    "summary": {
      "files": 0,
      "rows_applied": 0,
      "conflicts": 3,
      "files_with_conflicts": 2
    }
  }
  ```

  Exit code `1`; stderr one-liner points at the JSON for humans; `--json` puts the full envelope on stdout.

- **Q4 — CLI surface.** Verb shape:
  - **(a) `codemap apply <recipe-id>`** — positional.
  - **(b) `codemap apply --recipe <id>`** — named flag, consistent with `query`.
  - **(c) Both — accept positional, alias `--recipe`.**

  ### Q4 Resolution

  **Locked: (a) Positional only.**

  Reasoning:
  - **Verb-shape, not query-shape.** Apply is a directed action; the recipe id is the _target_. Mirrors `codemap show <name>` / `codemap snippet <name>` / `codemap impact <target>` / `codemap pr-comment <input>` / `codemap ingest-coverage <path>`. `query --recipe` is the exception (its positional slot is the SQL).
  - **Reads naturally with params.** `codemap apply rename-preview --params old=foo,new=bar --yes`. Adding `--recipe` would be more typing for zero meaning gain.
  - **Reject (c) "both."** Two ways to spell the same thing creates docs / completion / agent-prompt enumeration friction. Trivially additive if demand emerges.

  **Locked flag set for v1:**

  | Flag                                  | Behavior                                               |
  | ------------------------------------- | ------------------------------------------------------ |
  | `<recipe-id>`                         | Required positional; same ids `query --recipe` accepts |
  | `--params k=v[,k=v]`                  | Bind values for parametrised recipes (matches `query`) |
  | `--dry-run`                           | Preview only; no writes (per Q1)                       |
  | `--yes`                               | Skip TTY prompt; required for non-TTY (per Q6)         |
  | `--json`                              | Machine-readable envelope on stdout                    |
  | `--root` / `--config` / `--state-dir` | Inherited from `bootstrapCodemap`                      |

- **Q5 — Output envelope shape.** What does the JSON output look like, and is it the same shape for `--dry-run` and apply?
  - **(a) Mirror / extend `DiffJsonPayload`** — re-use the formatter shape with `applied: boolean` per hunk.
  - **(b) Standalone `ApplyJsonPayload`** — new shape designed for write-action semantics; same shape across both modes.

  ### Q5 Resolution

  **Locked: (b) Standalone `ApplyJsonPayload`, single shape across modes.**

  ```typescript
  interface ApplyJsonPayload {
    mode: "dry-run" | "apply";
    applied: boolean; // true only when mode=apply AND zero conflicts
    files: ApplyFile[]; // files that were/would-be modified
    conflicts: ConflictRow[]; // phase-1 validation results in both modes
    summary: {
      files: number; // distinct file_paths in row set
      files_modified: number; // 0 in dry-run
      rows: number; // total input rows
      rows_applied: number; // 0 in dry-run
      conflicts: number;
      files_with_conflicts: number;
    };
  }
  interface ApplyFile {
    file_path: string;
    rows_applied: number; // 0 in dry-run; non-zero only after write
    warnings?: string[];
  }
  interface ConflictRow {
    file_path: string;
    line_start: number;
    before_pattern: string;
    actual_at_line: string;
    reason: string; // "line drifted" | "file missing" | …
  }
  ```

  Reasoning:
  - **Same shape across modes.** Both `--dry-run` and apply run phase-1 validation and produce `conflicts: [...]`. Apply additionally writes after a clean validation; sets `applied: true` and populates `files[].rows_applied`. Consumers pattern-match on `mode` + `applied`.
  - **Reject (a) extending `DiffJsonPayload`.** Couples read-only preview formatter to write semantics — same kind of read/write coupling Slice 3 of recipe-recency unwound.
  - **`--dry-run` does NOT emit `DiffJsonPayload`.** Raw hunks are already available via `query --recipe X --format diff-json`. `apply --dry-run` adds value because it runs the validation pass and includes `conflicts: [...]` — "what would actually happen", not "what does the recipe describe."
  - **Exit codes:** `0` on clean apply OR clean dry-run; `1` on any conflicts (both modes).
  - **Text mode (default, no `--json`):** one-line human summary —
    - Apply success: `apply rename-preview: modified 3 files, applied 5 rows`
    - Apply with conflicts: `apply rename-preview: aborted (3 conflicts in 2 files); see --json for details`
    - Dry-run: `apply rename-preview --dry-run: would modify 3 files (5 rows). Re-run without --dry-run to apply.`

- **Q6 — Permission gating: confirmation prompt + `--yes`.**
  - **(a) TTY prompt + `--yes` to skip** — interactive gets y/n; non-interactive requires `--yes`.
  - **(b) Always-prompt** — even with `--yes`.
  - **(c) `--yes` only — no prompt** — non-interactive everywhere.

  ### Q6 Resolution

  **Locked: (a) TTY prompt + `--yes` to skip.**

  | Context                  | Behavior                                                                                            |
  | ------------------------ | --------------------------------------------------------------------------------------------------- |
  | TTY, no `--yes`          | Phase 1 runs. Print summary. Prompt `Proceed? [y/N]`. Default `N`. Phase 2 only on `y`.             |
  | TTY, `--yes`             | Skip prompt; proceed if validation clean.                                                           |
  | Non-TTY, no `--yes`      | Reject: `codemap apply: this verb writes files. Pass --yes for non-interactive runs, or --dry-run.` |
  | Non-TTY, `--yes`         | Proceed if validation clean.                                                                        |
  | Any context, `--dry-run` | Skip the prompt entirely; `--yes` is a no-op.                                                       |

  Reasoning:
  - **Ecosystem precedent.** Matches `gh` / `git` / `cargo` / `npm uninstall`. Universal pattern; users don't get surprised.
  - **TTY detection via `process.stdout.isTTY`** (Node + Bun support identically).
  - **Reject (b).** Prompting under `--yes` adds friction with no payoff; `--yes` should mean "I know what I'm doing."
  - **Reject (c).** TTY users lose the safety net for free.
  - **Default-N on prompt.** Pressing Enter aborts. Matches `gh repo delete` / `cargo uninstall`.

  **Prompt content** (printed before the y/N):

  ```
  apply rename-preview: 3 files, 5 rows
    - src/foo.ts (2 rows)
    - src/bar.ts (1 row)
    - src/baz.ts (2 rows)

  Proceed? [y/N]
  ```

- **Q7 — Idempotency: re-running on already-applied code.** If the user re-runs `codemap apply rename-preview --params old=foo,new=bar` on a project where the rename already landed:
  - **(a) Conflict-only path** — `before_pattern` (`foo`) doesn't match disk (`bar`); phase-1 reports as a conflict with `actual_at_line: "bar"`. User reads the diagnostic, runs `codemap` to refresh; re-run produces 0 rows (recipe finds nothing to rename) → vacuous clean apply.
  - **(b) Three-state phase-1: target / already-applied / conflict** — extra branch: if `after_pattern` is at `line_start`, treat as already-applied (silent skip, `summary.already_applied: N`). Re-runs without reindex are no-ops.

  ### Q7 Resolution

  **Locked: (a) Conflict-only path.**

  Reasoning:
  - **Simpler state machine.** Two states (apply target / conflict) vs three (target / already-applied / conflict). Less to document, less to test, less to misread.
  - **Conflict report is self-explanatory.** Q5's `actual_at_line` field shows what's on disk; user sees `actual_at_line: "bar"` against `before_pattern: "foo"` and immediately understands "the rename already landed." No interpretation lost vs (b).
  - **Forces index hygiene.** Re-running on a stale index hits a real conflict — the right user-action is `codemap` then retry, not silent self-healing. Same reasoning that rejected Q3 (c) auto-reindex.
  - **Moat-A clean.** Codemap reports `disk[line] != before_pattern`; it does NOT interpret "this looks like the rename you already ran." Verdict-shape avoided.
  - **Promotion path is additive.** If real users complain about reindex-then-retry friction, ship (b) as additional phase-1 metadata: `summary.already_applied: N` + per-file `rows_already_applied`. No shape break for existing consumers; existing fields remain accurate.

- **Q8 — `before_pattern` matching semantics.**
  - **(a) Exact match** — including whitespace; `disk[line_start..line_start + N] === before_pattern.split('\n')`.
  - **(b) Whitespace-tolerant** — collapse runs of whitespace before comparing.
  - **(c) Multi-line `before_pattern` support** — folded into (a)'s phase-1 implementation; not a separate option.

  ### Q8 Resolution

  **Locked: (a) Exact match.** Multi-line support is (a)'s implementation detail, not a separate option.

  **Phase-1 algorithm:**
  1. Load file at `file_path` (1-indexed line array).
  2. Split `before_pattern` on `\n` → N lines.
  3. Compare `disk[line_start..line_start + N - 1]` line-by-line to those N lines, byte-exact.
  4. Match → row passes validation.
  5. Mismatch → conflict; `actual_at_line` is `disk[line_start..line_start + N - 1].join('\n')`.

  Reasoning:
  - **Moat-A clean.** `before_pattern === disk` is observation; "close enough" is interpretation. Codemap does the former.
  - **Predictable for agents.** A whitespace-tolerant comparator opens the door to "match if you can"; agents can't reason about the false-positive surface.
  - **Recipe-author control.** Recipes already produce the rows — if normalization is wanted, the recipe SQL does it (e.g. `before_pattern` derived from `replace(source, char(9), ' ')`).
  - **(c) folds into (a).** `before_pattern` is `TEXT` and accepts `\n` today; phase-1 just splits on `\n` and reads the corresponding N consecutive lines. No schema delta. Documented as a recipe-author idiom.
  - **Reject (b).** Tolerance grows over time (collapse runs → trim → ignore EOL → ignore blank lines → …); each addition is more interpretation. Promotion path is recipe-side: a future recipe-frontmatter flag (`apply.whitespace_tolerant: true`) keeps the verdict where it belongs.

  **Edge cases handled by (a):**

  | Disk state                         | `before_pattern`             | Outcome                                                                   |
  | ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
  | File missing                       | any                          | conflict; `reason: "file missing"`                                        |
  | `line_start` past EOF              | any                          | conflict; `reason: "line out of range"`                                   |
  | Trailing whitespace differs        | exact recipe text            | conflict (correctly — file did drift)                                     |
  | EOL differs (`\r\n` vs `\n`)       | recipe authored on `\n` host | conflict; user normalizes EOL or recipe accepts both via parameterisation |
  | `before_pattern` has trailing `\n` | —                            | counted as N+1 lines; phase-1 reads N+1 lines (last is empty)             |

- **Q9 — Test approach.**
  - **Unit:** `apply-engine.ts` — `applyDiffPayload({rows, projectRoot, dryRun})` + helpers. Temp-dir scenarios for happy path / conflict / dry-run / file-missing / out-of-range / multi-line `before_pattern`.
  - **Integration:** subprocess CLI tests against a fixture project (mirrors `cmd-query-recency.test.ts`) — full pipeline from `codemap apply rename-preview --params … --yes` through to disk-state assertions. TTY-prompt path tested via `--yes` flag (skipping prompt); non-TTY-no-`--yes` rejection tested explicitly.
  - **Golden:** add a recipe-execution scenario to `fixtures/golden/scenarios.json` covering the dry-run output shape (deterministic; doesn't write to disk).

  ### Q9 Resolution

  **Locked: three-layer approach as drafted, with two explicit non-tests:**
  1. **No TOCTOU race tests.** Q2 accepted the validate→write window as negligible (apply isn't adversarial). Document the assumption in the engine docstring; don't add flaky timing-based tests.
  2. **No filesystem DI.** Match `coverage-engine.ts` precedent — direct `readFileSync` / `writeFileSync` with temp-dir scoping at the test boundary. No injection overhead.
  3. **No clock injection.** Apply's logic is time-independent (unlike recipe-recency); skip the `clock` seam.

  Reasoning:
  - **Mirrors recipe-recency precedent.** Same three-layer split, same subprocess-style integration tests, same golden-fixture extension.
  - **Failure-mode tests live in unit + integration.** Read-only file (`fs.chmodSync(0o444)` in temp dir), partial-write crash simulation (kill mid-write — covered as a unit test with mocked `writeFileSync`).
  - **Fixture project for integration.** Reuses `tests/fixtures/sample-project/` shape; adds a tiny rename-target file the integration test can assert against.

- **Q10 — Boundary discipline + plan-file lifecycle.**

  ### Q10 Resolution

  **Locked: codify imports + delete-on-ship.**
  1. **Boundary check (write-path).** Only `cli/cmd-apply.ts` and `application/tool-handlers.ts` (the MCP/HTTP `apply` tool) import `apply-engine.ts` for production execution. Tests import directly. Codified via the same SQL kit recipe-recency uses (mirror at `architecture.md § Boundary verification — apply write path`):

     ```sql
     SELECT file_path
     FROM imports
     WHERE source LIKE '%application/apply-engine%'
       AND file_path NOT LIKE '%test%'
       AND file_path NOT LIKE '%cli/cmd-apply%'
       AND file_path NOT LIKE '%application/tool-handlers%';
     -- Must return 0 rows.
     ```

  2. **Plan-file lifecycle.** Delete this file after Slice 5 ships per `docs/README.md` Rule 3. Lift durable design into `architecture.md § codemap apply wiring`:
     - Engine API (`applyDiffPayload` signature + envelope shape from Q5).
     - Phase-1 algorithm (Q8 exact-match + multi-line splitting).
     - Exit-code contract (Q5 — `0` clean / `1` conflicts).
     - Q6 TTY/`--yes` gate matrix.
     - Q10 boundary SQL kit (re-runnable, like recipe-recency's).
     - Update `docs/glossary.md` with a `codemap apply` entry.
     - Update `agent rule + skill` in lockstep per `docs/README.md` Rule 10.

  Reasoning:
  - **Boundary discipline mirrors recipe-recency.** Same write-path / read-path split (apply has no read-path — it's a write-only verb, so the SQL kit is simpler).
  - **Closing-state lifecycle is "delete + lift," not "slim & keep in plans/."** Per `docs-governance` skill — plans don't survive the ship.

---

## High-level architecture (sketch — refines as Qs lock)

Three new pieces; engine reuses existing diff-formatter primitives.

1. **Engine (`src/application/apply-engine.ts`, new)** — pure transport-agnostic `applyDiffPayload({rows, projectRoot, dryRun})`. Mirrors `coverage-engine.ts` shape:
   - Validates row shape (same `DiffOpts` contract).
   - **Phase 1 (both modes):** for each row, read source, validate `before_pattern` against `disk[line_start..line_start + N]` per Q8.
   - **Phase 2 (apply only, all-validated):** write each modified file once via `writeFileSync` to a sibling temp path, then `rename` (atomic — guards against torn writes mid-process-crash). All-or-nothing per Q2 (c) — phase 2 is skipped entirely if phase 1 collects any conflicts.
   - Returns the Q5-shaped result envelope; `mode` is derived from `dryRun` (`dryRun ? "dry-run" : "apply"`).

2. **CLI shell (`src/cli/cmd-apply.ts`, new)** — argv parsing + bootstrap + dispatch. Mirrors `cmd-impact.ts` shape (positional target + flags + JSON envelope). Resolves `--recipe` → SQL → executes via `executeQuery` → passes rows to `apply-engine`.

3. **MCP/HTTP transport** — `application/tool-handlers.ts` gets a new `apply` tool. Same args envelope shape as `query_recipe` (recipe id + params + format) plus `--apply` / `--dry-run` flags. Resource handlers untouched (apply is a tool, not a resource).

No schema delta. No new SQL primitives. The engine consumes the existing `query-engine.ts` `executeQuery` output.

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

1. **Slice 1: engine + dry-run path.** `apply-engine.ts` with `applyDiffPayload({rows, projectRoot, dryRun: true})` returning the Q5-shaped envelope. Unit tests covering happy path / conflict / file-missing. No CLI yet — verify via direct engine import.
2. **Slice 2: write path.** Add `dryRun: false` branch — `writeFileSync` per file with atomic temp-rename. Q2 transactional unit enforced. Failure-mode unit tests (read-only file, partial-write crash simulation).
3. **Slice 3: CLI + recipe execution.** `cmd-apply.ts` argv + bootstrap + dispatch. `--params` plumbing matches `query --recipe`. Q6 TTY-prompt + `--yes` gate. Subprocess integration tests against a fixture project (mirrors `cmd-query-recency.test.ts`).
4. **Slice 4: MCP/HTTP tool.** `apply` tool registration + `tool-handlers.ts` handler. Output shape matches the CLI's `--json` envelope. `query_batch` doesn't get an `apply` analogue (Moat-A: batched writes are verdict-shaped; consumers compose multiple `apply` calls).
5. **Slice 5: docs lockstep + plan retire.** `docs/architecture.md` § `apply` wiring; `docs/glossary.md` `codemap apply` entry; agent rule + skill in lockstep (Rule 10); roadmap entry removed; **plan file deleted** per Rule 3.

---

## Test approach

Covered inline at Q9. Each slice ships its own tests; Slice 5 runs the docs / agent-surface lockstep.

---

## Risks / non-goals

| Item                                                                                                | Mitigation                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-goal:** verdict-shaped fix engine (auto-detect dead code, refactor suggestions, AST rewrite). | Per L.4 (Floor "No fix engine"). `apply` only executes the diff hunks the SQL row describes — recipe SQL is the synthesis surface, not the engine.                                                                  |
| **Non-goal:** apply from arbitrary stdin / file payload (`apply --from <file.json>`).               | Per L.8. Recipe-execution-only for v1 keeps "the recipe IS the SQL" framing intact. Promote if a CI pipeline asks with a concrete shape.                                                                            |
| **Non-goal:** SARIF / annotations output for `apply`.                                               | Per L.9. SARIF is for findings; apply has its own envelope. Q5 resolves the shape.                                                                                                                                  |
| **Risk:** apply leaves files in a broken syntactic state on conflict.                               | Per Q2 (c) per-recipe-run all-or-nothing — any conflict in any file aborts the whole run before phase 2; partially-edited files never ship. Atomic temp-rename guarantees no torn writes mid-process-crash.         |
| **Risk:** stale index → stale `line_start` → wrong line edited.                                     | Per L.3 — `before_pattern` re-validation catches every staleness mode. Recipe is re-run inside `apply` (per L.8) so the rows reflect the current index, not a captured snapshot.                                    |
| **Risk:** non-TTY contexts (CI, MCP) accidentally write without confirmation.                       | Per Q6 (a) — non-TTY requires explicit `--yes`. Agents must opt in; CI workflows must list the flag.                                                                                                                |
| **Risk:** plan abandoned mid-iteration.                                                             | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. The engine slice (Slice 1) is independently useful even if the CLI never lands (could become a programmatic API). |

---

## Cross-references

- [`docs/roadmap.md § Backlog`](../roadmap.md#backlog) — `codemap apply` entry (deleted by Slice 5 cleanup).
- [`docs/architecture.md`](../architecture.md) — destination for the durable design (Slice 5).
- `application/output-formatters.ts` `DiffOpts` / `DiffJsonPayload` / `formatDiffJson` — input contract reused verbatim.
- `templates/recipes/rename-preview.{sql,md}` — the exemplar parametrised recipe consumed by `apply`.
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location + deletion-on-ship).
- [`docs/README.md` Rule 10](../README.md) — agent rule + skill lockstep update (Slice 5).
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence.
- [`.agents/skills/docs-governance/SKILL.md § Closing a plan`](../../.agents/skills/docs-governance/SKILL.md#closing-a-plan) — delete-on-ship discipline.
