---
"@stainless-code/codemap": minor
---

`codemap apply <recipe-id>` — substrate-shaped fix executor over the existing `--format diff-json` row contract. The recipe SQL describes the transformation (`{file_path, line_start, before_pattern, after_pattern}` rows); codemap is the executor. Floor "No fix engine" preserved — codemap doesn't synthesise edits, it only executes the hunks the recipe row described.

**Three transports, one engine:**

- **CLI:** `codemap apply <recipe-id> [--params k=v[,k=v]] [--dry-run] [--yes] [--json]`
- **MCP tool:** `apply` (registered alongside `impact` / `show` / `snippet`)
- **HTTP:** `POST /tool/apply`

All three dispatch the same pure `applyDiffPayload` engine in `application/apply-engine.ts`.

**Decisions worth knowing (Q1–Q10 locked in `docs/plans/codemap-apply.md`, lifted into `docs/architecture.md § Apply wiring` on this PR):**

- **Apply-by-default, `--dry-run` opts into preview.** Verb-name semantics + `git apply` / `terraform apply` precedent.
- **Per-recipe-run all-or-nothing (Q2 (c)).** Phase 1 validates every row first; any conflict aborts phase 2 entirely before any file is touched. Cross-file invariants matter — `rename-preview` produces a definition row + N import rows, and partial application leaves the project syntactically broken.
- **Scan-and-collect conflicts (Q3 (b)).** Phase 1 walks every row and collects all conflicts in one pass — better remediation UX than fail-fast.
- **TTY prompt + `--yes` gate (Q6 (a)).** Interactive contexts (TTY) get a `Proceed? [y/N]` prompt with default-N; non-interactive contexts (CI / agents / MCP / HTTP) require `--yes` (or `yes: true`) explicitly. `--dry-run` + `--yes` mutually exclusive.
- **Substring match per row, single-line (Q8 (a)).** Mirrors `buildDiffJson`'s contract verbatim — `actual.includes(before_pattern)` + `actual.replace(before, after)` with `$`-pre-escape per `String.prototype.replace`'s GetSubstitution rule. Exemplar: `templates/recipes/rename-preview.sql` emits `before_pattern = old_name` (the bare identifier).
- **Atomic per-file writes via temp + rename.** Sibling `<file>.codemap-apply-<rand>.tmp` then `renameSync` — POSIX-atomic so concurrent readers see either pre-rename or post-rename content, never a torn write.
- **Q7 idempotency (conflict-only path).** Re-running on already-applied code reports `line content drifted` with `actual_at_line` showing the post-rename content; user re-runs `codemap` to refresh the index → next run produces 0 rows → vacuous clean apply.
- **Single envelope shape across modes (Q5).** `{mode, applied, files, conflicts, summary}` — same shape for `dry-run` and `apply`; consumers pattern-match on `mode` + `applied`.
- **No SARIF / annotations.** Apply is a write action, not a findings list.

**Boundary discipline (Q10):** only `cli/cmd-apply.ts` + `application/tool-handlers.ts` may import the apply engine — re-runnable kit at `docs/architecture.md § Boundary verification — apply write path`.

Plan: PR #77 (merged). Implementation: this PR.
