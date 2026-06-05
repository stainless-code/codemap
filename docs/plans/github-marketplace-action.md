# GitHub Marketplace Action — plan

> **Status:** partially shipped · fact-checked 2026-05-18. Slices 1-4 are implemented in-tree: `audit --format sarif`, `query --ci`, `audit --ci`, root `action.yml`, package-manager detection, `codemap pr-comment`, and non-blocking CI dogfood all exist. Open work is now Slice 5: `MARKETPLACE.md`, `v1.0.0` / floating `v1` tags, Marketplace listing setup, external smoke, and hardening `action-smoke` after publish.
>
> **Motivator:** GitHub Marketplace is the dominant discovery + adoption surface for tools in the codebase-intelligence cohort, and codemap is currently absent from it. The in-repo Action closes the CI wrapper gap once it is tagged and listed; until then consumers can use the CLI surfaces directly or a local-path action ref.
>
> **Tier:** M effort. Wraps existing CLI surface; no schema changes, no new engines, no new transports. Only new substrate is the optional PR-comment writer (~one TS module).
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)

---

## Agent start here

**Slices 1–4 are shipped in-tree.** Open work is **Slice 5 only** (git tags, Marketplace listing, sacrificial-repo smoke, harden `action-smoke`). Do not re-implement SARIF/`--ci`/composite steps unless fixing a regression. Follow [§ Slice 5 runbook](#slice-5-runbook-post-merge--anyone-can-pick-up) sequentially.

### Key touchpoints

| File                                                                                 | What to read                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`action.yml`](../../action.yml)                                                     | Composite inputs + install/run/upload steps (shipped wrapper) |
| [`src/cli/cmd-audit.ts`](../../src/cli/cmd-audit.ts)                                 | `--format sarif`, `--ci` (Slice 1a)                           |
| [`src/cli/cmd-query.ts`](../../src/cli/cmd-query.ts)                                 | `query --ci` (Slice 1b)                                       |
| [`src/cli/cmd-pr-comment.ts`](../../src/cli/cmd-pr-comment.ts)                       | PR summary renderer (Slice 3)                                 |
| [`src/application/output-formatters.ts`](../../src/application/output-formatters.ts) | `formatSarif` audit delta mapping                             |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)                         | `action-smoke` job (`continue-on-error` until v1 publishes)   |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml)               | Changesets tag workflow — Slice 5 tags piggyback here         |

### Architecture (shipped)

```text
GitHub workflow: uses: stainless-code/codemap@v1
  → action.yml: detect PM → install @stainless-code/codemap → run audit --base --ci (PR only)
  → SARIF upload (Code Scanning) + optional pr-comment step
```

### Tracer bullet (Slice 5)

`MARKETPLACE.md` → tag `v1.0.0` + floating `v1` → listing metadata → sacrificial-repo smoke → flip `action-smoke` to blocking gate.

### Out of scope (Slice 5)

New Action inputs; `mode: aggregate` multi-recipe SARIF; audit verdict thresholds; Docker action image.

### Verification

```bash
# Shipped surfaces (regression before tagging)
bun test src/cli/cmd-audit.test.ts src/cli/cmd-query.test.ts
bun src/index.ts audit --base origin/main --ci            # SARIF + exit code on additions
bun src/index.ts query --recipe deprecated-symbols --ci

# After v1 tag + listing
# sacrificial public repo: uses: stainless-code/codemap@v1 on pull_request
```

---

## Pre-locked decisions

These are committed to v1. Questions opened against them must justify against the linked decisions.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| L.1 | **Composite action**, not Docker. Reuses host runner's Node + caches; faster cold-start; no image registry to maintain.                                                                                                                                                                                                                                                                                                                    | GitHub Actions best practice for npm-distributed CLIs                                                                              |
| L.2 | **Action repo lives at `stainless-code/codemap`**, published under the same git tag (`@v1`, `@v1.2.3`). No `codemap-action` split repo. _(Q-B grill: split-repo's drift risk is asymmetric — `codemap-action@vN` pinned against `codemap-cli@vM` can hit a removed flag and fail silently in CI; same-repo prevents this by construction.)_                                                                                                | Marketplace allows publishing from any repo path; same-repo keeps `action.yml` in lockstep with CLI behaviour                      |
| L.3 | **Moat-A clean** — every Action output is a `query --recipe <id>` or `audit --base <ref>` rendering through `--format sarif` / `--format annotations` / JSON. No verdict-shaped primitives in the Action.                                                                                                                                                                                                                                  | [Moat A](../roadmap.md#moats-load-bearing)                                                                                         |
| L.4 | **No telemetry hook in the Action.** No usage pings, no failure callhome. Logs stay on the runner.                                                                                                                                                                                                                                                                                                                                         | [Floor "No telemetry upload"](../roadmap.md#floors-v1-product-shape)                                                               |
| L.5 | **No mutation of repo state by default** — the Action runs read-side codemap verbs (`audit`, `query --recipe`, `--format sarif`/`annotations`). Optional PR-comment writer is opt-in.                                                                                                                                                                                                                                                      | [Floor "No fix engine"](../roadmap.md#floors-v1-product-shape)                                                                     |
| L.6 | **`--ci` aggregate flag + `--format sarif` on `audit` are in scope and shipped.** `--ci` exists on `query` AND `audit` (the two finding-producing verbs); aliases `--format sarif` + non-zero exit-on-issue (`query`: any row; `audit`: delta additions). **`query --ci` only** also suppresses the no-locatable-rows stderr warning. `--no-watch` is **not** wrapped — only `mcp`/`serve` have a watcher; meaningless on `query`/`audit`. | Pure CLI surface; cheap; lifts the Action wrapper from ~12 commands to one                                                         |
| L.7 | **Audit verdict + thresholds stay deferred.** Action ships with raw deltas + SARIF; the verdict-config trigger (two consumers shipping `jq` thresholds) gates promotion.                                                                                                                                                                                                                                                                   | [`roadmap.md § Backlog` audit-verdict item](../roadmap.md#backlog) — Action shipping is itself a likely accelerant for the trigger |

---

## Decisions of record (Q1–Q10 — embodied in shipped artifacts)

Grill resolutions are frozen in the shipped files — don't re-litigate here. Full Q1–Q10 prose: `git log --follow -- docs/plans/github-marketplace-action.md`.

| Topic                                      | Canonical home                                                       |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Input surface (~16 declarative inputs)     | [`action.yml`](../../action.yml)                                     |
| PM detection                               | [`scripts/detect-pm.mjs`](../../scripts/detect-pm.mjs)               |
| CLI install (`execute-local` vs `execute`) | `action.yml` install step                                            |
| Default PR behavior (`audit --base --ci`)  | `action.yml` default `mode`                                          |
| PR summary comment (opt-in `pr-comment`)   | [`cmd-pr-comment.ts`](../../src/cli/cmd-pr-comment.ts)               |
| `mode: aggregate`                          | Deferred — rejected in `action.yml` until v1.x                       |
| `@v1` floating tag + CLI decoupling        | [§ Slice 5 runbook](#slice-5-runbook-post-merge--anyone-can-pick-up) |
| Dogfood (`bun src/index.ts` override)      | `.github/workflows/ci.yml` `action-smoke`                            |

**LSP sibling:** [`lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) — same recipe substrate, IDE formatter vs SARIF. Sequential, not blocking.

**Shipped substrate:** `action.yml` · `audit`/`query` `--format sarif` + `--ci` · `cmd-pr-comment` · no schema changes.

---

## Implementation slices

| Slice | Status      | Surface                                                |
| ----- | ----------- | ------------------------------------------------------ |
| 1     | **Shipped** | `audit --format sarif`, `query`/`audit` `--ci`         |
| 2     | **Shipped** | Root [`action.yml`](../../action.yml)                  |
| 3     | **Shipped** | [`cmd-pr-comment.ts`](../../src/cli/cmd-pr-comment.ts) |
| 4     | **Shipped** | `ci.yml` `action-smoke` (non-blocking until `v1`)      |
| 5     | **Open**    | Tags, `MARKETPLACE.md`, listing — runbook below        |

### Slice 5 runbook (post-merge — anyone can pick up)

Slices 1-4 are in-tree; Slice 5 is a sequenced manual runbook that requires a merged commit + access to the Marketplace publishing UI.

**Pre-condition: CLI / Action version stream decoupling (per Q7).** The Action's `@v1` and the CLI's npm version live in separate namespaces — Action publishes at `v1.0.0` independent of CLI version. The Action's default invocation does `<pm> dlx @stainless-code/codemap@latest`, so the CLI just needs the shipped `--format sarif` (audit) + `--ci` flags available on npm. **CLI v1.0.0 is not required** for Action v1.0.0.

**Steps:**

1. Confirm the current npm release contains the Action-required CLI surfaces.
2. Changesets release workflow on `main` runs automatically for any needed CLI/package bump.
3. From the merge commit, tag git `v1.0.0`:

   ```bash
   git tag -a v1.0.0 -m "GitHub Marketplace Action v1"
   git push origin v1.0.0
   ```

4. Force-push the floating `v1` tag to the same commit:

   ```bash
   git tag -f v1 v1.0.0
   git push --force origin v1
   ```

5. **One-time Marketplace listing setup** (per Q10 checklist):
   - Pick icon (reuse codemap brand asset if exists; else pick during this step).
   - Brand colour: GitHub Marketplace palette.
   - Tags: `code-quality`, `static-analysis`, `code-search`, `code-intelligence`. **Avoid `linter`** (Moat-A "no opinionated rule engine").
   - Description (≤150 chars per Marketplace constraint): "SQL-queryable structural index of your codebase. Run any predicate as a recipe; CI gating via SARIF → Code Scanning."
   - README: point Marketplace at `MARKETPLACE.md` (action-focused) rather than the codemap-CLI root README. Author `MARKETPLACE.md` in this step if it doesn't exist.
   - Discipline: listing copy respects [`plan-pr-inspiration-discipline`](../../.agents/rules/plan-pr-inspiration-discipline.md) (no peer-tool comparisons in the listing) + aligns with [`docs/why-codemap.md`](../why-codemap.md).
6. Smoke-test on a sacrificial public repo: `- uses: stainless-code/codemap@v1` in `.github/workflows/`; trigger a PR; verify SARIF surfaces in Code Scanning.
7. Follow-up PR (post-publish):
   - Update `README.md § CI` to lead with the Action.
   - Flip `action-smoke` CI job from `continue-on-error: true` to a hard gate (Action now publishes a v1 with the right CLI flags, so the smoke meaningfully validates them).
   - Per [`docs/README.md` Rule 3](../README.md), **delete `docs/plans/github-marketplace-action.md`**. Durable design decisions already live in:
     - `docs/architecture.md` § "PR-comment wiring" + § "Audit wiring" + § "Output formatters" (CLI + engine seams)
     - `docs/glossary.md` (`--ci` + `pr-comment` entries)
     - `.agents/rules/codemap.md` + `templates/agents/rules/codemap.md` (agent surface)
     - `MARKETPLACE.md` (consumer-facing)
   - Remove the GitHub Marketplace Action backlog entry from `roadmap.md` per Rule 2.

**Subsequent releases:** changesets-driven (existing pipeline). On every merge to `main` that bumps `package.json`:

- Tag `v<major>.<minor>.<patch>` at the merge commit.
- Force-push `v<major>` floating tag to the same commit (`git tag -f v<major> <sha> && git push --force origin v<major>`).
- npm publish runs automatically.
- Marketplace auto-syncs from the same git tag — no separate publish step.

**Major bump (`v1.x.y → v2.0.0`):** create a new `v2` floating tag at the breaking-change commit; `v1` stops moving. Backports to `v1.x.y` are not promised (single-major-supported policy per Q7).

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

- [`docs/roadmap.md § Backlog`](../roadmap.md#backlog) — backlog entry + audit-verdict trigger that this Action's adoption is likely to fire.
- [`docs/plans/lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) — sibling plan rendering same recipe substrate to IDE / VSCode surface; complementary, not competitive (see "Relationship to (d) LSP plan" section above).
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location).
- [`docs/README.md` Rule 8](../README.md) — closing-state lifecycle if abandoned.
- [`docs/README.md` Rule 10](../README.md) — agent rule + skill lockstep update (Slice 5).
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence.
