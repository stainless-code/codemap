# GitHub Marketplace Action — plan

> **Status:** open · candidate next pick (M effort, high distribution leverage). Re-prioritised by impact-rank amendment in [`research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) — most primitives already shipped (PR #43 SARIF/annotations on `query`, PR #26 `--changed-since`/`--group-by`/`--summary`, PR #30 baselines, PR #52 `audit --base <ref>`, PR #72 boundary-violations), so a thin Action wrapper closes the discovery / adoption loop. **Two genuine new CLI surfaces** are required (per fact-check 2026-05): `--format sarif` on `audit` (today only emits `--json`) and the `--ci` aggregate flag on `query`/`audit`. Both land in v1.0 alongside the Action.
>
> **Motivator:** GitHub Marketplace is the dominant discovery + adoption surface for tools in the codebase-intelligence cohort, and codemap is currently absent from it. Today's CI integration story is "write a workflow that runs `codemap audit --base ${{ github.base_ref }} --json`, transform JSON to SARIF, then upload the artifact" — a five-step recipe most teams don't write. A `- uses: stainless-code/codemap@v1` one-liner closes that gap. The Action's missing pieces: composite `action.yml` (Slice 2), PR-comment writer (Slice 3), and two new CLI surfaces — `audit --format sarif` and the `--ci` aggregate flag (Slice 1).
>
> **Tier:** M effort. Wraps existing CLI surface; no schema changes, no new engines, no new transports. Only new substrate is the optional PR-comment writer (~one TS module).

---

## Pre-locked decisions

These are committed to v1. Questions opened against them must justify against the linked decisions.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| L.1 | **Composite action**, not Docker. Reuses host runner's Node + caches; faster cold-start; no image registry to maintain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | GitHub Actions best practice for npm-distributed CLIs                                                                              |
| L.2 | **Action repo lives at `stainless-code/codemap`**, published under the same git tag (`@v1`, `@v1.2.3`). No `codemap-action` split repo. _(Q-B grill: split-repo's drift risk is asymmetric — `codemap-action@vN` pinned against `codemap-cli@vM` can hit a removed flag and fail silently in CI; same-repo prevents this by construction.)_                                                                                                                                                                                                                                                                                                                                                                                                 | Marketplace allows publishing from any repo path; same-repo keeps `action.yml` in lockstep with CLI behaviour                      |
| L.3 | **Moat-A clean** — every Action output is a `query --recipe <id>` or `audit --base <ref>` rendering through `--format sarif` / `--format annotations` / JSON. No verdict-shaped primitives in the Action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [Moat A](../roadmap.md#moats-load-bearing)                                                                                         |
| L.4 | **No telemetry hook in the Action.** No usage pings, no failure callhome. Logs stay on the runner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [Floor "No telemetry upload"](../roadmap.md#floors-v1-product-shape)                                                               |
| L.5 | **No mutation of repo state by default** — the Action runs read-side codemap verbs (`audit`, `query --recipe`, `--format sarif`/`annotations`). Optional PR-comment writer is opt-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [Floor "No fix engine"](../roadmap.md#floors-v1-product-shape)                                                                     |
| L.6 | **`--ci` aggregate flag + `--format sarif` on `audit` are both in scope.** `--ci` lands on `query` AND `audit` (the two finding-producing verbs); aliases `--format sarif` + non-zero exit-on-issue + quiet mode. `audit` separately gains `--format sarif` (today it only emits `--json`) so the headline α default actually composes. _(Fact-check 2026-05: original draft assumed `audit --format sarif` already existed — it doesn't; `cmd-audit.ts` only accepts `--json` / `--summary` / `--no-index` / `--baseline` / `--base`. Adding it is the right long-term CLI surface — any CI consumer benefits, not just the Action.)_ `--no-watch` is **not** wrapped — only `mcp`/`serve` have a watcher; meaningless on `query`/`audit`. | Pure CLI surface; cheap; lifts the Action wrapper from ~12 commands to one                                                         |
| L.7 | **Audit verdict + thresholds stay deferred.** Action ships with raw deltas + SARIF; the verdict-config trigger (two consumers shipping `jq` thresholds) gates promotion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [`roadmap.md § Backlog` audit-verdict item](../roadmap.md#backlog) — Action shipping is itself a likely accelerant for the trigger |

---

## Open decisions (iterate as the plan converges)

These are the design questions the plan-PR resolves before impl starts. Each gets a "Resolution" subsection below as it crystallises.

- **Q1 — `action.yml` input surface.** Three shapes considered: minimum viable (~7 inputs, `command:` as the universal escape hatch), phased rollout (7 → 12 → 16 across v1.0 / v1.1 / v1.2), and ideal day-one (~16 declarative inputs).

  **Resolution (Q-B grill):** **ship the ideal day-one** — ~16 declarative inputs in v1.0. Reasoning: consumers in this Actions cohort (`actions/setup-node`, `actions/upload-artifact`, `oven-sh/setup-bun`, …) expect 10-15-input density and reach for declarative inputs over shell-string composition; structured inputs compose cleanly with `${{ }}` interpolation and surface in IDE autocomplete; "use `command:` for everything non-trivial" pushes consumers into shell-string forking that's worse for both ergonomics and our listing's example matrix.

  **v1.0 input list (~16):**

  ```yaml
  inputs:
    # WHERE TO RUN
    working-directory: # monorepo subdir (default: .)
    package-manager: # autodetect override: npm | pnpm | yarn | bun
    version: # pin CLI version; empty = project devDep → latest fallback
    state-dir: # override `.codemap/` location

    # WHAT TO RUN — high-level (mutually exclusive; precedence: command > mode > defaults)
    mode: # audit | recipe | aggregate | command (default: audit)
    recipe: # recipe id (when mode=recipe)
    params: # multiline key=value (when mode=recipe)
    baseline: # saved baseline name (when mode=recipe)
    audit-base: # git ref (default: ${{ github.base_ref }} on pull_request events)
    changed-since: # filter to files changed since ref
    group-by: # owner | directory | package
    command: # raw CLI args (escape hatch; precedence over all above)

    # WHAT TO DO WITH OUTPUT
    format: # sarif | json | annotations | mermaid | diff (default: sarif)
    output-path: # default: codemap.sarif
    upload-sarif: # default: true (skip if no GHAS)
    pr-comment: # default: false (per Q4)
    fail-on: # any | error | warning | never (default: any)
    token: # default: ${{ github.token }}
  ```

  **Validation rules (action's pre-step):**
  - Precedence: `command` > `mode` > defaults. If `command` is set, all `mode` / `recipe` / `params` / `baseline` / `audit-base` / `changed-since` / `group-by` inputs are ignored with a single warning log line.
  - `mode: recipe` requires `recipe`; missing → hard error.
  - `mode: audit` ignores `recipe` / `params` / `baseline` (warning); requires `audit-base` (defaults from PR event context, see Q5 resolution).
  - `mode: aggregate` requires Q6 multi-recipe SARIF rule.id de-dup landed (see ripple below).
  - Mutually-exclusive combos that don't compose (e.g. `baseline` + `audit-base`) → hard error with a remediation hint pointing at the `command:` escape hatch.

  **Ripples:**
  - **Q6 promoted from "verify before committing" to v1.0 blocker.** Shipping `mode: aggregate` day-one means the multi-recipe SARIF rule.id de-duplication needs to be solved before v1.0 ships, not deferred. Updated below.
  - **v1.x input additions** likely concentrate on edge cases the v1.0 16 don't cover (e.g. `min-severity`, `recipes-dir`, `fts5`). Promotion bar: ≥2 consumer requests with concrete shapes.

- **Q2 — Package-manager autodetection.** Detect `pnpm-lock.yaml` / `bun.lock` / `yarn.lock` / `package-lock.json` to pick the install command, OR require an explicit `package-manager: npm|pnpm|yarn|bun` input.

  **Resolution:** **delegate to [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector)** (antfu/userquin, MIT, 0 deps, 23 kB) via a tiny `scripts/detect-pm.mjs` wrapper invoked from `action.yml`'s composite steps. The library implements the equivalent priority ladder we'd hand-roll (lockfile → `packageManager` field → `devEngines.packageManager` field → install-metadata → walk-up to parent dir) **plus two cases we'd otherwise miss**: install-metadata (the most reliable signal when present) and `devEngines.packageManager`. Walk-up support is built in, which solves the monorepo subdir case.

  Wrapper sketch (action's pre-step):

  ```javascript
  import { detect } from "package-manager-detector/detect";
  import { resolveCommand } from "package-manager-detector/commands";

  const pm = await detect();
  const agent = pm?.agent ?? "npm";
  // resolveCommand handles `npm exec` vs `pnpm exec` vs `bun x` vs `yarn dlx` — Q3 lookup-table for free
  console.log(`::set-output name=agent::${agent}`);
  ```

  Precedence: `package-manager:` input still wins when set (overrides detection). When unset, the library's default strategy order applies. Multiple-lockfile case is handled by the library; we surface its result + log a warning if ambiguous.

  Rejected alternatives: hand-rolled bash detection (~30 lines, misses `install-metadata` + `devEngines.packageManager`); explicit-only (friction); try-each-fallback (slow — cascading failed installs); corepack-only (silently fails when `packageManager` field absent).

  **Cost:** one runtime dependency. Mitigated by 0 transitive deps + 23 kB + antfu maintenance + the alternative being a 30-line bash detection ladder we'd debug forever. Need `actions/setup-node` (or runner-preinstalled Node) to execute the detection script — most workflows already have this; if missing, the action adds it as an implicit pre-step.

- **Q3 — Where to invoke the CLI.** `bun x codemap` if Bun is on the runner? `npx codemap`? Local-install via `package.json` is the dominant path (codemap is a `devDependency` for most consumers).

  **Resolution: project-installed first, download-and-execute fallback.** Maps directly onto `package-manager-detector`'s two `resolveCommand` intents — `'execute-local'` (already installed) vs `'execute'` (download and run). No hand-rolled per-agent branching; the library resolves `npx` / `bunx` / `pnpm dlx` / `yarn dlx` itself.

  ```
  if version-input is set:
    intent = 'execute'                  # forced download with pinned version
    cli = resolveCommand(agent, 'execute',       ['codemap@<version>'])
  elif codemap in devDependencies:
    intent = 'execute-local'            # consumer's install step already brought codemap in
    cli = resolveCommand(agent, 'execute-local', ['codemap'])
  else:
    intent = 'execute'                  # not installed; pull latest
    cli = resolveCommand(agent, 'execute',       ['codemap@latest'])
  ```

  Reasoning: matches consumer's pinned version by default (no surprise drift between local dev and CI); project-local recipes (`<projectRoot>/.codemap/recipes/`) work for free; faster on cached runners (`node_modules/.bin/codemap` already there post-`npm ci`). `version:` input forces a pinned `'execute'` when set — explicit override stays clean. Rejected execute-only (ignores consumer's pinned version), project-only (friction for trial-run), pinned-first inversion (the strongest signal is "what runs locally", which is `package.json#devDependencies`).

  **Edge cases:**
  - **Version mismatch warning.** If `version:` input is set AND `codemap` is in `devDependencies` AND they disagree → log a warning ("Action input version=X differs from project devDependency Y; using input"). Don't error — consumer may be deliberately overriding.
  - **`bun src/index.ts` for codemap-itself dogfood (Slice 4).** This repo's CI calls codemap pre-build. Use `command:` override pointing at `bun src/index.ts ...` rather than the published binary. Slice 4 documents this as the known special case.

- **Q4 — PR-comment writer scope.** Three escalating shapes:
  - **(a) None** — Action emits SARIF only; users wire their own comment-writer Action downstream. Smallest surface; ships v1 fastest.
  - **(b) Summary comment only** — single PR comment with collapsible sections per recipe (rendered from `audit --json` or `query --recipe X --format json`). Closes the dominant "what changed in this PR?" review use case.
  - **(c) Inline review comments** — per-row comments on changed lines with `actions` template hint. Closes the rest; needs careful rate-limiting (`max-comments` cap is mandatory).

  **Resolution (Q-A grill):** ship **(b) Summary comment** in v1.0; **(c) Inline review comments** deferred to v1.x with a concrete demand trigger (any one of: a consumer asks with a concrete shape, a bot-host integration like CodeRabbit/Copilot/Cursor-bot requests structured PR-comment seeding, or audit-verdict + thresholds ship and the verdict line wants per-line surfacing). The v1.0 summary comment matters most in the cases SARIF→Code-Scanning doesn't cover well: private repos without GHAS (Code Scanning unavailable), repos that haven't enabled Code Scanning, aggregate `audit --base <ref>` deltas that lack a `file:line` anchor, trend / delta narratives ("coverage 87 % → 84 %"), and bot-context seeding (review bots read PR conversation, not workflow artifacts). v1.0 default for the comment toggle is **opt-in** (`pr-comment: true` Action input) so consumers who already have Code Scanning don't get duplicated surfaces. Toggle defaults flip later if usage shows the comment is the universally expected surface.

- **Q5 — Default command for the Action.** What does `- uses: stainless-code/codemap@v1` with zero inputs do?
  - Option α: `codemap audit --base ${{ github.base_ref }} --format sarif` — one-shot structural-drift on every PR, SARIF uploaded to Code Scanning.
  - Option β: `codemap query --recipe deprecated-symbols --format sarif` (or another single recipe) — narrower, less surprising.
  - Option γ: aggregate run — `audit` + a curated set of recipes (`untested-and-dead`, `boundary-violations`, `deprecated-symbols`) — broader coverage but more opinionated.
  - Option δ: bare `codemap --ci`, project config decides — pushes opinion to consumers; needs new config schema.

  **Resolution (Q-B grill):** **α + skip-on-non-PR**. On `pull_request` events the Action runs `codemap audit --base ${{ github.base_ref }} --ci` (which emits SARIF + non-zero exit + quiet, per Slice 1's `--ci` semantics). On any other event (`push`, `schedule`, `workflow_dispatch`, …) the Action no-ops with `echo "codemap action: no PR context, skipping"` and exits 0 — there's no meaningful default without a base ref, and firing β-style opinionated recipes on push events surfaces findings consumers didn't ask for. β is a worse α (no PR-scoped diff). γ is the real alternative but blocks on Q6 (multi-recipe SARIF rule.id de-dup) — promote to a `mode: aggregate` input in v1.x once consumers signal demand. δ over-engineers a config concept that doesn't exist. Consumers wanting push-event runs pass an explicit `command:` input.

- **Q6 — SARIF rule.id taxonomy under `mode: aggregate`.** _(Promoted to v1.0 blocker by Q1 resolution — shipping the ideal day-one means `mode: aggregate` is a v1.0 input.)_ Already shipped: `--format sarif` emits `rule.id = codemap.<recipe-id>` per recipe. Aggregate runs (multiple recipes in one Action invocation) need a stable convention for combining results — likely concat-into-one-sarif-file with rule definitions de-duplicated by `recipe-id` (each rule appears once in `tool.driver.rules[]` even if multiple recipes reference it; each finding's `ruleId` matches). **Resolution direction:** verify this composes cleanly in GitHub's Code Scanning UI on a sacrificial branch BEFORE Slice 2 lands. If aggregate-SARIF surfaces unexpected dedup behavior in Code Scanning, fall back to one-SARIF-per-recipe with `category:` distinguishing the streams (Code Scanning supports multiple SARIF uploads with different categories).
- **Q7 — Versioning + `@v1` tag strategy.** Convention: floating `@v1` major tag updated on every minor/patch release; `@v1.2.3` for pin-to-exact. `action.yml` lives at repo root; `dist/` is **not** required for composite actions (only for JS actions).

  **Resolution: floating major `@v1` + changesets-driven release.** Cohort norm (`actions/checkout@v4`, `actions/setup-node@v4`, `oven-sh/setup-bun@v2`, …); Renovate/Dependabot-friendly (major tags are the unit they bump on); enforces semver discipline (any input/output break is a v2 bump, never within v1.x).

  **Release workflow (concrete; piggybacks on existing changesets pipeline):**
  1. PR adds a changeset → merge to `main` bumps `package.json` version via the existing release pipeline.
  2. Release workflow on `main`:
     - Push exact tag `v1.2.3` at the merge commit.
     - **Force-update** `v1` floating tag to the same commit (`git tag -f v1 <sha> && git push --force origin v1`).
     - npm publish (already in pipeline).
     - Marketplace auto-syncs from the same tag — no separate publish step needed once the listing exists.
  3. Major bump (v1.x.y → v2.0.0): create new `v2` floating tag at the breaking-change commit; `v1` stops moving (consumers on `@v1` continue receiving v1.x.y patches if backports happen, otherwise frozen).

  **Backwards-compat discipline within v1:** floating `@v1` requires never breaking inputs/outputs in v1.x. New behaviors land as opt-in inputs (e.g. v1.0 ships `pr-comment: false` default; v1.5 may flip default but never removes the input).

  **Safety checks:**
  - **Tag force-push** must be allowed for `v1`. Branch protection rules in this repo currently apply to branches, not tags — verify before Slice 5.
  - **Tag signing** — sign exact tags (`v1.2.3`) via `gpg`; floating `v1` inherits no signature (it's a pointer, not a release tag). GitHub treats both as the source of truth for `@v1` resolution.
  - **Single major supported** — small-team policy. Document explicitly that backports to old majors aren't promised; consumers on `@v1` after `@v2` ships are responsible for migration when they want new behavior.

  **Action version stream is independent of CLI version stream.** Codemap CLI is currently at `0.4.0` in `package.json`; the Action publishes at its own `v1.0.0` regardless. Marketplace tags are per-repo; the Action's `v1` floating tag and the CLI's `0.4.x` npm versions occupy different namespaces and don't conflict. _(Fact-check 2026-05: original draft asserted "codemap CLI is already 1.x" — that was wrong. Decoupled version streams is actually the right shape: CLI semver tracks core engine stability; Action semver tracks the wrapper-input contract. They evolve independently.)_

  Rejected: minor-floating (`@v1.2`) — breaks Renovate/Dependabot conventions; exact-pin only — staleness without auto-bumping; branch-based (`@main`) — cohort rejects, too risky for CI.

- **Q8 — How does the Action run in private repos / monorepos?** Default `working-directory: .` works for single-package repos. For monorepos, expose `working-directory` input. CODEOWNERS-driven `--group-by owner` is already shipped — Action should pass through.

  **Resolution:** covered by earlier resolutions, no new substrate needed. Monorepo case → `working-directory` input (already in the v1.0 input list per Q1). Private-repo case → identical Action runtime; only differentiator is SARIF→Code-Scanning requires GitHub Advanced Security for private repos, which is the v1.0 motivation for the `pr-comment` writer existing (per Q4). CODEOWNERS-driven `--group-by owner` flows through `command:` or the v1.0 `group-by:` input.

- **Q9 — Codemap-itself's existing CI.** This repo's `.github/workflows/ci.yml` runs golden / benchmark / typecheck / lint. The Action would dogfood codemap on its own PRs (eat your own dogfood). Slice 4 wires this; verifies the Action against a real repo before publishing.

  **Resolution:** Slice 4 wires it via `command:` override pointing at `bun src/index.ts ...` rather than the published binary (codemap-itself runs from source pre-build) — already documented as the known special case in the Q3 resolution. No additional design substrate; Slice 4 is execution.

- **Q10 — Marketplace listing metadata.** Branding (icon + colour), description, tags (`code-quality`, `static-analysis`, `ai-agents`?), README rendered on the listing. Cosmetic but important for discovery. Defer to Slice 5 (publishing).

  **Resolution: defer to Slice 5 with a fixed checklist** so the cosmetic decisions don't drag:
  - **Icon:** reuse the existing codemap brand asset if one exists; otherwise pick during Slice 5.
  - **Colour:** GitHub Marketplace's brand-colour palette.
  - **Tags:** `code-quality`, `static-analysis`, `code-search`, `code-intelligence`. **Avoid `linter`** — codemap is Moat-A "no opinionated rule engine"; `linter` framing miscategorises the tool.
  - **Description (≤150 chars per Marketplace constraint):** "SQL-queryable structural index of your codebase. Run any predicate as a recipe; CI gating via SARIF → Code Scanning."
  - **README:** point Marketplace at an action-focused `MARKETPLACE.md` rather than the codemap-CLI root `README.md` — keeps the listing copy tight and action-shaped.
  - **Discipline:** listing copy must respect [`plan-pr-inspiration-discipline`](../../.agents/rules/plan-pr-inspiration-discipline.md) (no peer-tool comparisons in the listing) and align with [`docs/why-codemap.md`](../why-codemap.md) positioning.

Each open decision gets a "Resolution" subsection below as it crystallises (mirrors the c9-plan and research-note pattern).

---

## High-level architecture

Four pieces; the last two are genuinely new substrate:

1. **`action.yml`** at repo root — composite action declaring inputs (Q1), steps (detect package manager → install codemap → run command → upload SARIF). Pure declarative wrapper.
2. **`--format sarif` on `audit`** — extend `cmd-audit.ts` + `audit-engine` to route deltas through `output-formatters.ts`. Required because `audit` today only emits `--json`; the Action's headline α default needs SARIF directly. Decisions to make in Slice 1: SARIF shape for delta-rows (each `added` row → `result` with `ruleId` like `codemap.audit.files-added` / `codemap.audit.dependencies-added` / `codemap.audit.deprecated-added`; severity mapping; `locations` from `file_path`).
3. **`--ci` aggregate flag in `cmd-query.ts` and `cmd-audit.ts`** — wraps `--format sarif` + non-zero exit-on-issue + quiet mode. Tracer-bullet implementation: just an alias for `--format sarif` + `process.exitCode = 1` if any rows initially. Both verbs land it in the same slice — they share the `output-formatters.ts` substrate.
4. **PR-comment writer** (Q4 (b), Slice 3) — small TS module reading SARIF / audit JSON and rendering a markdown summary; posted via `gh api` from the Action's last step. Lives in `src/cli/cmd-pr-comment.ts` (new) so it's also testable / reusable outside the Action.

No schema changes. No new transports. The Action consumes existing engines.

---

## What this Action sharpens — and what it doesn't

**Sharpens (user-facing):**

- **Discovery** — Marketplace listing is the dominant top-of-funnel for codebase-intelligence tools; codemap's npm-only adoption path leaves that funnel empty.
- **Adoption friction** — `- uses: stainless-code/codemap@v1` is a single-line CI integration. Today's path is "write a workflow that runs `codemap audit --base ${{ github.base_ref }} --json`, transform JSON to SARIF, then upload the artifact" — a five-step recipe most teams don't write.
- **PR-review feedback loop** — SARIF surfaces in Code Scanning; annotations show inline; (Q4 (b)) summary comment lands in the PR conversation. Closes the "I ran codemap locally but it never reaches the reviewer" gap.

**Does NOT sharpen:**

- **Agent UX directly** — agents call MCP / CLI, not Actions. Indirect lift only: the Action seeds CodeRabbit / Copilot / Cursor-bot reviews with codemap's structural facts, which they then cite — but that's downstream of the Action's primary value.
- **Audit verdict semantics** — Action ships raw deltas + SARIF; pass/warn/fail thresholds remain backlog (per L.7). Shipping the Action is itself the most likely accelerant for the trigger fire (real consumers writing `jq` threshold scripts).
- **Recipe authoring** — Action consumes recipes, doesn't grow them. Project-local recipes (`<projectRoot>/.codemap/recipes/`) work in CI exactly as locally; no Action-specific surface.
- **IDE integration** — that's [`(d) LSP plan`](./lsp-diagnostic-push.md)'s scope; sibling plan, see relationship below.

## Relationship to `(d) LSP diagnostic-push` plan

[`lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) is the **sibling plan that renders the same recipe substrate to a different consumer surface** (IDE squigglies via VSCode extension + Open VSX, vs CI surfaces via GitHub Marketplace). Both plans are intentional separate scopes:

- **Same Moat-A discipline** on both: every output is a recipe rendering through `--format <X>`. Reviewer test ("is this finding queryable via `query --recipe X`?") is identical.
- **Same recipe set rendered** (`untested-and-dead`, `unimported-exports`, `boundary-violations`, `high-complexity-untested`, `deprecated-symbols`, `components-touching-deprecated`).
- **Different formatter** — Action ships `--format sarif` on `audit` (Slice 1a); LSP ships `--format lsp-diagnostic`. Both extend `output-formatters.ts` the same way; the Action's audit-SARIF shape decisions (delta-row → SARIF `result` mapping) are precedent the LSP plan can mirror.
- **Sequential, not blocking either way.** Action ships first (M effort, no monorepo conversion needed — `action.yml` is a single root file). LSP ships last (XL effort, may force the repo-structure decision per [`lsp-diagnostic-push.md § Repo-structure tradeoffs`](./lsp-diagnostic-push.md#repo-structure-tradeoffs-canonical-home-for-the-monorepo-vs-flat-decision)). Neither blocks the other.
- **Disjoint user populations** — Marketplace Action seeds CI users; VSCode extension seeds IDE users. The Action's listing copy can cross-link to the LSP extension once both ship, but neither requires the other.

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

**v1.0 scope (Q-A grill resolution — `i-full`):** all five slices land in v1.0. Inline review comments (Q4 (c)) are the only v1.x deferral; the summary comment (Q4 (b)) ships in v1.0 because the cases SARIF→Code-Scanning doesn't cover (private repos without GHAS, aggregate audit deltas, bot-context seeding) are present from day one and waiting for a demand signal would slow learning.

1. **Slice 1: `--format sarif` on `audit` + `--ci` aggregate flag on `query` and `audit`.** _(Two new CLI surfaces — fact-checked 2026-05; original draft assumed `audit --format sarif` already shipped, it doesn't.)_ Steps:
   - **1a.** Extend `cmd-audit.ts` parser to accept `--format sarif` (and route through `output-formatters.ts`). Decide SARIF shape for delta-rows: each `added` row → SARIF `result` with `ruleId` like `codemap.audit.files-added` / `codemap.audit.dependencies-added` / `codemap.audit.deprecated-added`; severity = `warning`; `locations[]` from `file_path` when available, omitted for aggregate-count rows. New `audit-engine` integration with `output-formatters.ts`. Test: golden-scenario SARIF output for a fixture audit.
   - **1b.** Add `--ci` flag to both `cmd-query.ts` and `cmd-audit.ts`. Aliases `--format sarif` + `process.exitCode = 1` if any rows/deltas + quiet stdout. Test: `bun src/index.ts query --recipe deprecated-symbols --ci` and `bun src/index.ts audit --base origin/main --ci` both produce SARIF + non-zero exit when findings exist.
   - No Action yet — Slice 1 verifies the CLI surfaces the Action will wrap. Independently useful: any non-Action CI consumer benefits from `--ci` immediately.
2. **Slice 2: `action.yml` minimum.** Composite action with `command` + `working-directory` inputs only. Steps: detect package-manager (per Q2), install codemap (per Q3 — project-installed first, `'execute'` fallback), run `<resolved-cli> <input.command>`, upload SARIF artifact. Smoke-test via `act` or a sacrificial branch. End-to-end: PR opens → Action runs `codemap audit --base ${{ github.base_ref }} --ci` → artifact uploaded.
3. **Slice 3: PR-comment writer (Q4 (b) summary only).** New `src/cli/cmd-pr-comment.ts`: takes SARIF or audit JSON, emits markdown summary. Action's optional final step calls it + posts via `gh pr comment`. Toggle via `pr-comment: true` Action input (default **`false`** for v1.0 — opt-in to avoid duplicating Code Scanning surfaces for users who already have GHAS). Default may flip in v1.x if usage shows the comment is universally expected.
4. **Slice 4: dogfood on this repo.** Wire the published Action (or a local-path action ref during dev) into `.github/workflows/ci.yml`. The PR adding the Action's first release runs it on itself — eat-our-own-dogfood verifies the wrapper end-to-end before any external consumer sees it.
5. **Slice 5: publish + Marketplace listing.** Tag `v1.0.0`, push fast-forward `@v1`, fill listing metadata (icon, description, tags). Verify discoverability. Update `README.md § CI` to lead with the Action. Update agent rule + skill (per [Rule 10](../README.md)) so agents recommending codemap CI integration cite the Action first.

---

## Test approach

- **Unit:** `--ci` flag handling + PR-comment renderer — `*.test.ts` per touched file.
- **Integration (CLI):** golden scenario for `--ci` (existing query-golden harness).
- **Integration (Action):** GitHub workflow on this repo runs the Action against a small fixture-repo branch; assertions on SARIF output + comment text via `gh` API. Equivalent to the e2e test in `audit-engine.test.ts` but for the Action wrapper.
- **Marketplace listing** — manual verification post-publish (icon renders, install copy works, tags are searchable).

---

## Risks / non-goals

| Item                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-goal:** verdict-shaped Action output (pass/warn/fail).          | Per L.3 / L.7; ships raw deltas + SARIF. Promotion gated on backlog audit-verdict trigger.                                                                                                                                                                                                                                                                                                         |
| **Non-goal:** mutating repo state from CI.                            | Per L.5; PR-comment writer is opt-in. No `codemap fix` (we don't ship one — see Floor "No fix engine").                                                                                                                                                                                                                                                                                            |
| **Non-goal:** Docker-image action.                                    | Per L.1; composite only. Slower runners + image-registry maintenance not worth the marginal portability gain.                                                                                                                                                                                                                                                                                      |
| **Risk:** Action wrapper calls a CLI flag the CLI no longer has.      | Per L.2 same-repo publishing — `action.yml` and CLI live in the same git tag, so an Action change requiring a CLI flag lands in the same PR that adds the flag. Cross-version drift is structurally prevented (the failure mode of split-repo publishing). Note: Action version stream stays independent of CLI version stream per Q7 — `@v1` floats forward; CLI follows its own `0.x.y` cadence. |
| **Risk:** SARIF rule.id collision under `--ci` aggregate (Q6).        | Slice 1 verifies single-recipe SARIF passes Code Scanning; Slice 2 / 3 verify multi-recipe aggregation. Defer aggregate to v1.1 if Code Scanning rejects the shape.                                                                                                                                                                                                                                |
| **Risk:** PR-comment writer rate-limits / over-posts (Q4 (c) future). | v1 ships **summary only** (Q4 (b)); inline-review comments deferred until demand signal. `max-comments` cap mandatory before (c) ships.                                                                                                                                                                                                                                                            |
| **Risk:** Marketplace listing rejected.                               | Read GitHub's Marketplace publishing docs before Slice 5; Slice 4 dogfooding catches breakage before publish. Composite actions for npm-distributed CLIs are a well-trodden Marketplace path — no structural blocker.                                                                                                                                                                              |
| **Risk:** plan abandoned mid-iteration.                               | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. `--ci` flag (Slice 1) is independently useful even if Action publishing slips.                                                                                                                                                                                                                   |

---

## Cross-references

- [`docs/research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical) — pick-order rationale + the 2026-05 impact-vs-cadence amendment that surfaced this pick.
- [`docs/roadmap.md § Backlog`](../roadmap.md#backlog) — backlog entry + audit-verdict trigger that this Action's adoption is likely to fire.
- [`docs/plans/lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) — sibling plan rendering same recipe substrate to IDE / VSCode surface; complementary, not competitive (see "Relationship to (d) LSP plan" section above).
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location).
- [`docs/README.md` Rule 8](../README.md) — closing-state lifecycle if abandoned.
- [`docs/README.md` Rule 10](../README.md) — agent rule + skill lockstep update (Slice 5).
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence.
