---
name: upgrade-packages
description: >-
  Delta-driven dependency upgrades — a script gathers the evidence, you read the artifact and judge. Use when the user asks to upgrade, bump, or CVE-audit dependencies.
---

# Upgrade packages

A script gathers every release delta, GHSA advisory, and codebase-usage site into one JSON artifact; you read it and judge. **Never touch the registry, GitHub, or GHSA directly** — every citation comes from the artifact (`diffUrl`, `changelogUrl`, advisory `url`), so no model priors sneak in. Sources of truth: the artifact, then the codebase. Cite where you read every claim.

This repo uses **bun** with **exact** pins in `package.json` — `bun update` alone bumps nothing. Lift an exact pin with `bun update <pkg>@<target>` (or `bun update <pkg> --latest` per package) / a `package.json` edit. Never `bun update --latest` across the board. The `check-updates` script is inventory-only.

## Phase 1 — Gather evidence

Run `bun run upgrade-packages:evidence` (defaults to `--out scripts/upgrade-packages/artifact.json`; pass `--out <path>` to override). **Requires network access** — the script calls `gh api` (GitHub releases + GHSA advisories) and `bun pm view`; a sandboxed network allowlist that blocks `api.github.com` will make every gh call fail (the artifact degrades to `error` markers with `changelogUrl` deep-dive links). Release/advisory data is cached to `scripts/upgrade-packages/.cache/` (1h TTL) so re-runs are fast and don't re-trip rate limits. Read the artifact. Schema + how-to-read: [`REFERENCE.md`](./REFERENCE.md).

**Done when:** the artifact exists and you've read `inventory`, `outdated`, `audit`, `deltas`, and `usage`.

## Phase 2 — Triage (judge the artifact)

For each `outdated` package, produce a cited verdict + band:

- **band** = `bumpClass` (patch/minor/major/prerelease). **Coupled deps:** if a patch bump's peer/dep requires a minor+ bump of another direct dep (check `deltas[<pkg>][].peerEngine` + the other package's `bumpClass`), move the coupled set up a band.
- **priority-bump** if `audit.ghsa` verdict is `priority-bump` — goes first within its band.
- **check-failed** if `audit.ghsa` verdict is `check-failed` (gh/parse/cache failure, `id:"error"`) — inconclusive, not a vuln; re-run evidence or deep-dive the `changelogUrl` before treating as blocked.
- **blocked** if any `deltas[<pkg>][].error` leaves the range uncovered and the missing version can't be sourced via its `diffUrl`, OR a `breaking`/`security`/`peerEngine` delta is a break-risk you can't resolve (see Phase 3).
- **deferred-major** for a major with an unresolved break — unless it clears a high/critical advisory, in which case surface the tradeoff to the user.

Cite the `diffUrl`/`changelogUrl`/advisory `url` for every verdict.

**Done when:** every outdated package has a cited verdict, a band, and a coupled-set tag; every `priority-bump` is flagged for Phase 3.

## Phase 3 — Fact-check break-risk against the codebase

For every **break-risk delta** (`breaking`, `deprecations`, `peerEngine`, or a behavior-changing fix in `security`/`features` — e.g. callback debounce, CVE patch altering semantics), cross-check `usage[<pkg>]`. Use `callSites` (codemap) for **blast radius** — where the symbol is actually called, not just imported; `importedSymbols` + `typeOnlySymbols` for what's in scope; `sites` for import locations. Classify: **no usage** / **code-aligned** / **breaks** (needs a code change first). Cite `callSites`/`sites` (file:line). A `breaks` with no code change → the bump is **blocked** or **deferred**.

**Done when:** every break-risk delta has a citation-backed `no usage | aligned | breaks` verdict; every `breaks` has a proposed code change.

## Phase 4 — Apply, gated by risk

Bands: patch → minor → major, verify after each per [`verify-after-each-step`](../../rules/verify-after-each-step.md). Within each band, **priority-bump** packages first; **coupled sets** move up together; **prereleases** go in the patch band (moving-target, same-major-line gate).

1. **Patch** — bump together (`bun update <pkg>@<target>` per package); run the CI mirror (below).
2. **Minor** — bump together; same checks.
3. **Major** — one at a time; land its `breaks` code change _first_, bump, then checks. Defer unresolved majors (cited reason) unless they clear a high/critical advisory.

A bumped parser/resolver/CSS package can change extraction output — re-run `bun run test:golden` and regenerate any affected goldens. Re-run `bun audit` after each band — a **new** advisory → revert that bump and re-research. Commit per band **only when the user asked to commit**.

**Done when:** CI mirror (`bun run check` + `bun run build`) green for patch + minor; every major green-and-committed/staged or deferred with a cited reason; no `breaks` unaddressed; final `bun audit` clean or every remaining advisory documented.

## Phase 5 — Verify (local CI mirror)

Run what `.github/workflows/ci.yml` runs — `ci.yml` is the SSOT:

- `bun run check` → build + format:check + lint:ci + test + test:scripts + typecheck + test:golden + test:agent-eval (5 of 6 CI jobs: Format, Lint, Typecheck, Test, Build)
- `bun run build` → covered by `check`, but re-run explicitly if a bump only touched build tooling (tsdown/oxc) — **do not skip**; dep upgrades break the bundler/codegen far more often than types
- `bun audit` → CI's audit job blocks on **high/critical** (it greps `bun audit` output for `high:` / `critical:`); treat any high/critical advisory as **blocking-with-triage**, lower severities as documented

## Phase 6 — Report

Produce: **security** (advisories → verdict, with GHSA id + URL + fixed-in), **consolidated changeset** (rolled up from `deltas` — per package `current → target`, bucketed breaking/deprecations/features/fixes/peer-engine, one line per delta), **adoption opportunities** (top ~5 `features` deltas the codebase isn't using — `usage` verdict + file:line + one-line why-adopt + follow-up; non-blocking), bumped packages (band → version → why-safe), deferred/blocked (cited reason + file:line), verification results. Every citation from the artifact. If the user asked to commit/PR, hand off to [`harden-pr`](../harden-pr/SKILL.md) full mode.

**Done when:** report accounts for every non-no-op package and advisory; every citation is real — no `possibly`, `likely`, or unstated assumptions.

## Anti-patterns

- ❌ Touching the registry/GitHub/GHSA directly — run the script, read the artifact.
- ❌ `bun update --latest` across the board — per-package `--latest`/`package.json` edit for exact pins.
- ❌ Treating `bun audit` as pass/fail — every advisory needs a cited verdict; a high/critical audit is blocking-with-triage.
- ❌ Skipping `bun run build` — bundler/codegen breakage beats type breakage for dep upgrades.

## Reference

- [`REFERENCE.md`](./REFERENCE.md) — evidence artifact schema + how to read it
- [`verify-after-each-step`](../../rules/verify-after-each-step.md) — per-band checks
- [`harden-pr`](../harden-pr/SKILL.md) — full mode before PR
