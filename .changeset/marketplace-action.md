---
"@stainless-code/codemap": minor
---

GitHub Marketplace Action — Slices 1b-4 of [`docs/plans/github-marketplace-action.md`](../docs/plans/github-marketplace-action.md). v1.0 readiness; `action.yml` is now installable via `- uses: stainless-code/codemap@v1` once the corresponding tag is published.

**`--ci` aggregate flag (Slice 1b)** on `query` + `audit`. Aliases `--format sarif` + `process.exitCode = 1` on findings/additions + suppresses no-locatable-rows stderr warning. Mutually exclusive with `--json` and `--format <other>`. Parser rejects contradictions with helpful errors.

**`action.yml` + `scripts/detect-pm.mjs` (Slice 2).** Composite Action wrapping the codemap CLI. ~16 declarative inputs across 3 categories (where to run / what to run / what to do with output); Q1 resolution. Default α command on `pull_request` events: `audit --base ${{ github.base_ref }} --ci`; no-op on other events unless an explicit `command:` input is passed. Package-manager autodetection delegates to [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) (antfu/userquin, MIT, 0 transitive deps); CLI invocation resolution via the library's `'execute-local'` / `'execute'` intents.

**`codemap pr-comment` (Slice 3).** New CLI verb that renders a markdown PR-summary comment from a codemap-audit-JSON envelope or a SARIF doc. Auto-detects input shape; `--shape audit|sarif` overrides. Reads from a file or stdin (`-`). `--json` envelope emits `{ markdown, findings_count, kind }` for action.yml steps. Closes the SARIF→Code-Scanning gap for: private repos without GHAS, repos that haven't enabled Code Scanning, aggregate audit deltas without a single file:line anchor, trend / delta narratives, and bot-context seeding (review bots read PR conversation, not workflow artifacts). v1.0 ships the (b) summary-comment shape per Q4 resolution; (c) inline-review comments deferred to v1.x.

**Dogfood (Slice 4).** New `action-smoke` job in `.github/workflows/ci.yml` runs `uses: ./` on every PR with `command: --version` to validate the composite-step flow + npm-pulled codemap binary. Non-blocking until v1.0.0 ships (at which point the smoke gates the build).

**Engine + CLI separation discipline preserved:** `pr-comment-engine.ts` is pure; `cmd-pr-comment.ts` wraps it. Tests cover the engine (12 cases) and the CLI parser (4 audit + 4 query tests for `--ci`).

**Lockstep agent updates** (per `docs/README.md` Rule 10): `.agents/rules/codemap.md` + `templates/agents/rules/codemap.md` gain rows for `--ci` and `pr-comment` so installed agents and this clone's session view stay in lockstep.

Slice 5 (Marketplace publish + listing metadata) is post-merge — gated on a v1.0.0 tag.
