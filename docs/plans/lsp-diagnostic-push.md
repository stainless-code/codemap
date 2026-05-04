# (d) LSP diagnostic-push server + paired VSCode extension — plan

> **Status:** open · plan iterating in parallel with (b) C.9 + every shipping-cadence item before (d). Pick-order rationale (the (d) v1 → v2 → v3 three-revisions arc) at [`research/non-goals-reassessment-2026-05.md § 5`](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical).
>
> **Motivator:** humans-in-IDEs surface for codemap's recipe outputs. Diagnostics-as-squigglies for `untested-and-dead`, `components-touching-deprecated`, `boundary-violations`, `unimported-exports`, `high-complexity-untested`, `deprecated-symbols` callers. Hover provider over `symbols.signature` + `doc_comment` + `complexity` + caller-count fills a gap `tsserver` doesn't (codemap-unique metadata, not types). Code lens for fan-in / complexity / coverage. Code actions hooked to `recipe.actions` template.
>
> **Tier:** XL effort (per the research note's § 5 (d) row). Two paired components: `codemap-lsp` server + `codemap-vscode` extension. Server alone is incomplete — extension is required to consume the custom `codemap/analysisComplete` notification + render status bar / tree views.
>
> **Reference implementation:** fallow's [`crates/lsp/`](https://github.com/fallow-rs/fallow/tree/main/crates/lsp) (~1800 LoC, `tower-lsp`) + [`editors/vscode/`](https://github.com/fallow-rs/fallow/tree/main/editors/vscode) (~2400 LoC TS, `vscode-languageclient`). Inspected 2026-05; same shape mapped onto codemap recipes.

---

## Pre-locked decisions (from non-goals-reassessment grill 2026-05)

These are committed to v1. Questions opened against them must justify against the linked decisions.

| #   | Decision                                                                                                                                                                                                                                            | Source                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L.1 | **Diagnostic-push shape, NOT request-handler shape.** No `textDocument/definition` / `references` / `hover types` / `workspace/symbol`. `tsserver` dominates those for JS/TS users; competing is wasted surface.                                    | [§ 2.5 v3 verdict](../research/non-goals-reassessment-2026-05.md#25-no-lsp-replacement); [§ 8 errata row](../research/non-goals-reassessment-2026-05.md#8-triangulation-errata-2026-05) |
| L.2 | **Moat-A discipline:** every diagnostic must be the `--format lsp-diagnostic` rendering of a bundled recipe. Reviewer test: "is this finding queryable via `query --recipe X`?" If no recipe drives the diagnostic, it's rejected.                  | [Moat A](../roadmap.md#moats-load-bearing)                                                                                                                                              |
| L.3 | **Moat-B aligned:** server consumes shipped engines (`application/show-engine.ts`, `application/impact-engine.ts`, `application/watcher.ts`); does NOT re-extract structure inside the protocol layer.                                              | [Moat B](../roadmap.md#moats-load-bearing); [§ 2.5 "no LSP engine"](../research/non-goals-reassessment-2026-05.md#25-no-lsp-replacement)                                                |
| L.4 | **Bun/Node binary, not Rust.** Keep the toolchain consistent; reuse engines via direct imports.                                                                                                                                                     | Operational — repo is TS                                                                                                                                                                |
| L.5 | **Server + extension is the unit, not either alone.** Custom `codemap/analysisComplete` notification requires the paired extension to render status bar / tree views; LSP-only consumption (no extension) is reduced UX, not v1.                    | [§ 2.5 v3 verdict](../research/non-goals-reassessment-2026-05.md#25-no-lsp-replacement); fallow precedent                                                                               |
| L.6 | **No JS execution at index time** survives — server speaks LSP, doesn't `eval` recipe SQL or extension-injected code.                                                                                                                               | [Floors "No JS execution at index time"](../roadmap.md#floors-v1-product-shape)                                                                                                         |
| L.7 | **Ships AFTER (b) C.9** per cadence. Not a hard block — (d) ships valid diagnostics on existing recipe outputs without (b); but landing (b) first means `untested-and-dead` / `unimported-exports` diagnostics inherit cleaner inputs from day one. | [§ 5 Rationale 5](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical)                                                                                      |

---

## Open decisions (iterate as the plan converges)

Each gets a "Resolution" subsection below as it crystallises (mirrors c9-plugin-layer.md / research-note § 6 pattern).

- **Q1 — Repo structure (flat vs monorepo).** Add `lsp/` + `editors/vscode/` to current flat layout (no workspaces; Option 1)? Convert to monorepo first (`packages/codemap` + `packages/codemap-lsp` + `packages/codemap-vscode`; Option 2)? Combine convert + (d) impl in one PR (Option 3)? Trade-offs in [§ Repo-structure tradeoffs](#repo-structure-tradeoffs) below.
- **Q2 — LSP server framework.** `vscode-languageserver` (Microsoft official, well-documented)? `vscode-jsonrpc` (lower-level, more control)? Custom over stdio? Bias toward `vscode-languageserver` for compatibility.
- **Q3 — Extension-to-server transport.** Stdio (mirrors fallow + LSP convention)? Or skip LSP entirely and have extension call codemap MCP/HTTP directly? **L.1 already locks LSP shape**, so this is "stdio vs IPC" not "LSP yes/no" — bias toward stdio.
- **Q4 — Which recipes become diagnostics in v1.** Candidate list: `untested-and-dead`, `unimported-exports`, `components-touching-deprecated`, `boundary-violations` (assuming § 1.5 ships first), `high-complexity-untested`, `deprecated-symbols` callers (need the call-site row, not the symbol row). Ship all 6 in v1 or start narrow?
- **Q5 — Diagnostic severity mapping.** `Error` for `boundary-violations`? `Warning` for `untested-and-dead` / `unimported-exports`? `Information` for `high-complexity-untested` / `deprecated-symbols` callers? Per-recipe configurable via `initializationOptions`?
- **Q6 — Hover provider scope.** Hover on every indexed symbol with `signature` + `doc_comment` + `complexity` + caller-count? Or only on symbols that have at least one of those (avoid noise on plain locals)? Coverage % when available?
- **Q7 — Code lens scope.** Fan-in count above functions? Complexity? Coverage? All three? Lens ON/OFF per kind via settings?
- **Q8 — Custom notification shape.** `codemap/analysisComplete` payload — counts per recipe (mirrors fallow's `total_issues` + per-category counts)? Or richer structure? Must remain stable across versions (extension reads it).
- **Q9 — Settings / initializationOptions surface.** Toggle each recipe ON/OFF (mirrors fallow's `issueTypes`)? Severity overrides? `changedSince` git ref to scope diagnostics to PR-changed files (mirrors fallow)?
- **Q10 — Auto-update / version-mismatch handling.** Extension bundles a binary version; what if user has a different `codemap` CLI installed globally? Warn? Use bundled? Use user's? Mirrors fallow's `binary-utils.ts` + `download.ts` resolution chain.
- **Q11 — Marketplace publisher name.** `stainless-code` (matches GH org)? Other? **One-time decision; renaming a publisher is hard.**
- **Q12 — Open VSX (VSCodium / Cursor / Theia) parity.** Publish to both VSCode Marketplace and Open VSX, or VSCode-only? Cursor users → likely yes for Open VSX.

---

## High-level architecture

Two paired components; engines stay shipped (no re-extraction).

### Component 1: `codemap-lsp` (Bun/Node binary)

```text
            ┌─────────────────────────────────────────┐
            │      codemap-lsp (stdio server)         │
            │                                         │
   editor ──┤  vscode-languageserver / jsonrpc        │
   stdio    │                                         │
            │  ┌───────────────────────────────────┐  │
            │  │ Diagnostic provider               │  │
            │  │   ↳ runs N recipes via shared    │  │
            │  │     query engine, emits          │  │
            │  │     Diagnostic[] per file URI    │  │
            │  └───────────────────────────────────┘  │
            │  ┌───────────────────────────────────┐  │
            │  │ Hover provider                    │  │
            │  │   ↳ findSymbolsByName + format   │  │
            │  └───────────────────────────────────┘  │
            │  ┌───────────────────────────────────┐  │
            │  │ Code lens provider                │  │
            │  │   ↳ calls / complexity / coverage │  │
            │  └───────────────────────────────────┘  │
            │  ┌───────────────────────────────────┐  │
            │  │ Code action provider              │  │
            │  │   ↳ recipe.actions → quick-fix   │  │
            │  └───────────────────────────────────┘  │
            │  ┌───────────────────────────────────┐  │
            │  │ Watcher (chokidar via             │  │
            │  │   application/watcher.ts)         │  │
            │  │   ↳ on file change → reindex →    │  │
            │  │     re-run diagnostics →          │  │
            │  │     publishDiagnostics + emit     │  │
            │  │     codemap/analysisComplete      │  │
            │  └───────────────────────────────────┘  │
            └─────────────────────────────────────────┘
                          │
                          ▼
            shared engines (existing, unchanged)
```

LSP handlers implemented:

- `initialize` / `initialized` / `shutdown` (lifecycle; reads `initializationOptions` for issue toggles)
- `did_open` / `did_change` / `did_save` (file-change debouncing)
- `textDocument/diagnostic` (LSP 3.17 pull) + `publishDiagnostics` push for live updates
- `textDocument/hover`
- `textDocument/codeLens`
- `textDocument/codeAction`
- Custom: `codemap/analysisComplete` notification (push to extension)

LSP handlers NOT implemented (per L.1):

- ~~`textDocument/definition`~~
- ~~`textDocument/references`~~
- ~~`textDocument/documentSymbol`~~
- ~~`workspace/symbol`~~

### Component 2: `codemap-vscode` (TS extension)

```text
   ┌───────────────────────────────────────┐
   │      codemap-vscode extension         │
   │                                       │
   │  vscode-languageclient/node           │
   │   ↳ stdio → codemap-lsp binary        │
   │                                       │
   │  Status bar (live issue count)        │
   │   ↳ fed by codemap/analysisComplete   │
   │                                       │
   │  Tree views                           │
   │   ↳ codemap.deadCode                  │
   │   ↳ codemap.complexity                │
   │   ↳ codemap.boundaries                │
   │                                       │
   │  Commands                             │
   │   ↳ codemap.runRecipe                 │
   │   ↳ codemap.audit                     │
   │   ↳ codemap.refresh                   │
   │                                       │
   │  Settings UI                          │
   │   ↳ recipe toggles                    │
   │   ↳ severity overrides                │
   │   ↳ changedSince git ref              │
   │                                       │
   │  Binary resolution                    │
   │   ↳ user setting > local node_modules │
   │   ↳   > PATH > auto-download          │
   │   ↳ (mirrors fallow download.ts)      │
   └───────────────────────────────────────┘
```

---

## Implementation slices (tracer bullets)

Per [`tracer-bullets`](../../.agents/rules/tracer-bullets.md) — ship one vertical slice end-to-end before expanding.

1. **Slice 1: minimum viable diagnostic push.** `codemap-lsp` binary that runs ONE recipe (`untested-and-dead`) and pushes `Diagnostic[]` for it. Manual VSCode `launch.json` config to run against the binary; verify squigglies appear. No extension, no install flow yet.
2. **Slice 2: paired extension MVP.** Minimal `codemap-vscode` extension that connects to the binary via `vscode-languageclient/node`, displays squigglies. F5-debug from VSCode; not yet packaged.
3. **Slice 3: 6 recipes + severity mapping.** Add the 5 other diagnostic-shaped recipes (Q4); resolve severity per Q5.
4. **Slice 4: hover + code lens + code actions.** Wire the three remaining LSP capabilities (Q6, Q7); code actions consume `recipe.actions` template.
5. **Slice 5: custom notification + extension UI.** `codemap/analysisComplete` notification; status bar + tree views + commands in extension.
6. **Slice 6: settings + binary resolution.** `initializationOptions` (Q9) + extension's binary resolver (Q10).
7. **Slice 7: marketplace publish.** First publish (one-time; see [§ Marketplace publishing](#marketplace-publishing-prerequisites) below for the flow). Tag-triggered CI workflow.
8. **Slice 8: docs + agent rule update.** Per [`docs/README.md` Rule 10](../README.md), update bundled agent rule + skill in lockstep — agents need to know the LSP binary exists, what it surfaces, and that the diagnostic codes correspond to recipe IDs.

---

## Repo-structure tradeoffs (canonical home for the monorepo-vs-flat decision)

> Cross-referenced by [`c9-plugin-layer.md` Q5/Q8](./c9-plugin-layer.md#open-decisions-iterate-as-the-plan-converges) (community plugin packaging) and [`docs/roadmap.md` Backlog](../roadmap.md#backlog) (structural decision tracker). All structural-conversion analysis lives **here** — other docs link, never restate.

### Current state (2026-05)

- **Single TS package** at repo root: `name: "@stainless-code/codemap"` in `package.json`; `src/` is the only TS source root; `bun src/index.ts` is the dev entry; published to npm as one package with one `bin: codemap`.
- **No workspace tooling.** No `workspaces` field, no `packages/` directory, no `tsconfig.references`. `tsdown` builds a single bundle to `dist/`.
- **Multiple consumer-facing surfaces already coexist** in this flat structure: CLI (`codemap`), MCP server (`codemap mcp`), HTTP server (`codemap serve`), watch mode (`codemap watch`). All ship as one binary; transport is a `cmd-*.ts` dispatch, not a separate package.

### Why this question surfaces now

Two upcoming surfaces would each ship a **second binary or second publishable artifact**:

1. **(d) LSP diagnostic-push server + paired VSCode extension** — `codemap-lsp` Bun/Node binary + `codemap-vscode` extension package (published to VSCode Marketplace + Open VSX, NOT npm).
2. **(b) C.9 community plugins** — per [c9-plugin-layer Q5/Q8](./c9-plugin-layer.md#open-decisions-iterate-as-the-plan-converges), the plugin contract may want plugins as separate npm packages (e.g. `codemap-plugin-nextjs`) so framework-specific knowledge lives outside core.

Either alone can ship in the current flat layout. Both together start to strain it.

### The three options

| Option                                                  | Cost                                                                                                                                                                                                                                                                                                                                                                                             | Benefit                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1: Stay flat** — add `lsp/` + `editors/vscode/` dirs  | Zero refactor. Relative imports from `lsp/` into `src/application/*` work today. One additional `bin: { "codemap-lsp": "..." }` in main `package.json`. Extension is its own `package.json` (different name, different version, published to VSCode Marketplace not npm — already independent of CLI versioning regardless of layout choice).                                                    | Simplest path. No risk to existing code. Ships (d) without prerequisite work. **Loses:** independent versioning between CLI and LSP server (one changeset bumps both). **Loses:** clean package boundary if a third-party wants to consume engines as a library (no `@stainless-code/codemap-core` to import). |
| **2: Convert to monorepo first** (separate refactor PR) | ~1-2 days of churn. Touches every import in `src/`, every test path, every doc reference (`bun src/index.ts` → `bun packages/codemap-cli/src/index.ts` or aliased), every script reference (`scripts/*.ts`), every changeset config (per-package). CI scripts updated. Risk surface unrelated to (d) value. Reviewer reaction to "refactor PR with no user-visible value" is generally negative. | Independent versioning per package. Clean `packages/codemap-core` exposing engines. Ready for C.9 community plugins. Standard pattern (oxc, tsgo, fallow's Cargo workspace, biome, vitest). Bun workspaces + changesets handle locked-or-independent versioning natively.                                      |
| **3: Convert as part of (d) impl**                      | Bigger PR (refactor + new feature combined). Harder to review.                                                                                                                                                                                                                                                                                                                                   | Convert once, justify once with the new packages it creates. Avoids the "refactor PR with no user-visible value" review pushback.                                                                                                                                                                              |

### Reference: what other TS tools do

| Tool                                                                              | Layout                                                                                                                                                                                                                   | Why                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **fallow** ([upstream](https://github.com/fallow-rs/fallow))                      | Monorepo (Cargo workspace: `crates/cli`, `crates/lsp`, `crates/core`, `crates/extract`, `crates/graph`, `crates/mcp`, `crates/v8-coverage`, `crates/config`); `editors/vscode/` + `editors/zed/` outside cargo workspace | Rust forces this for multi-binary projects. VSCode extension is TS, separately published             |
| **knip** ([upstream](https://github.com/webpro-nl/knip))                          | Single npm package; VSCode extension lives in a [completely different repo](https://github.com/webpro-nl/knip-vscode)                                                                                                    | Choice — extension maintainer is a different contributor; full repo-split rather than monorepo       |
| **oxc** ([upstream](https://github.com/oxc-project/oxc))                          | Monorepo (pnpm workspaces): `napi/parser`, `napi/transform`, `napi/resolver`, `crates/oxc_*` (Rust), `editors/vscode`                                                                                                    | Ships many tools (parser, formatter, linter, resolver) as separable packages — natural workspace fit |
| **tsgo / typescript-go** ([upstream](https://github.com/microsoft/typescript-go)) | Monorepo (Go modules + npm packages)                                                                                                                                                                                     | Multi-binary + multi-language                                                                        |
| **biome** ([upstream](https://github.com/biomejs/biome))                          | Monorepo (pnpm workspaces): `packages/@biomejs/biome`, `packages/@biomejs/js-api`, `editors/vscode`, `editors/intellij`, `crates/*` (Rust core)                                                                          | Multiple language editors + Rust core + JS bindings                                                  |
| **vitest** ([upstream](https://github.com/vitest-dev/vitest))                     | Monorepo (pnpm workspaces): `packages/vitest`, `packages/browser`, `packages/coverage-*`, `packages/vite-node`, `packages/ui`                                                                                            | Many separable concerns ship together                                                                |

**Pattern:** monorepo is dominant when a tool ships **3+ independently-publishable artifacts**. Single-package wins when there's just one (knip).

For codemap, the artifact count grows from **1** (today: CLI) to:

- **2** after (d) ships (CLI + VSCode extension; extension already published separately regardless of layout)
- **3+** if (d) extracts `codemap-core` for the LSP server to import cleanly
- **5+** if C.9 community plugins ship as packages

Inflection point is roughly between (d) and C.9 community plugins.

### When to revisit (triggers, not preferences)

Convert (Option 2 or 3) when **any** of these triggers fire — not preemptively:

1. **C.9 community plugins ship as separate packages.** Strong signal — community contributors expect to install `codemap-plugin-nextjs`, not patch a directory in core. Workspace tooling makes this hygienic; flat layout fights it.
2. **A user asks "I want to consume the engines as a library."** Triggers extraction of `codemap-core`. If the ask comes after (d) ships, extracting alongside `codemap-lsp` justifies the conversion.
3. **A second consumer-facing distro ships** (e.g. `codemap-server` long-running daemon decoupled from CLI). Workspaces let it iterate independently.
4. **Locked versioning across packages becomes painful** with the hand-script approach in Option 1 (e.g. CLI bumps without LSP server changes still need a changeset entry for the LSP package — annoying enough times that the workspace tooling pays for itself).

Mirrors the doc's other "wait for two consumers / two asks" disciplines (research note § 6 Q5 history table, B.5 verdict thresholds).

### Default bias (revisit during plan iteration)

- **Option 1** if (d) ships before any of the four triggers above. (d) alone doesn't justify conversion — the VSCode extension is separately published anyway, and the LSP binary can be a second `bin` entry in the existing `package.json`. **This is the recommended starting position.**
- **Option 2** (separate refactor PR before (d) impl) if a community-plugin contributor is in flight when (d) starts, or if `codemap-core` extraction is asked for explicitly.
- **Option 3** (convert as part of (d) impl) if Option 2's "refactor with no user-visible value" PR shape is unacceptable to reviewers.

### What stays out of scope here

- **User-repo monorepo awareness** (separate concept — discovering `pnpm-workspace.yaml` in indexed projects). Tracked in [`docs/roadmap.md` Backlog](../roadmap.md#backlog) "Monorepo / workspace awareness."
- **Splitting `templates/agents/` into a separate package.** Templates ship in the main codemap package via `files: ["templates"]`; no consumer signal for a separate package today.
- **VSCode-extension repo split** (knip's pattern — separate repo). Out of scope; codemap's extension lives alongside core.

---

## Marketplace publishing prerequisites

One-time setup captured here so the (d) impl PR doesn't have to rediscover it. References: [VSCode publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Open VSX docs](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

### Accounts + tokens (one-time, ~30 min)

1. **Azure DevOps organization** at [dev.azure.com](https://dev.azure.com) (free; Microsoft account).
2. **Marketplace publisher** at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) — pick publisher ID per Q11. Publisher ID is in the marketplace URL forever.
3. **Personal Access Token (PAT)** in Azure DevOps:
   - User Settings → Personal Access Tokens → New Token
   - Scope: **Organization** = "All accessible organizations"; **Marketplace** = ✅ Manage
   - Max expiration 1 year (Microsoft enforces); calendar-reminder for renewal
4. **Open VSX namespace** at [open-vsx.org](https://open-vsx.org) per Q12 — separate token; same `.vsix` file works on both marketplaces.

### Required extension files (`editors/vscode/`)

- `package.json` — must include `name`, `displayName`, `description`, `version`, `publisher`, `repository.directory`, `engines.vscode`, `categories`, `activationEvents`, `main`, `contributes`
- `README.md` — becomes the marketplace page
- `LICENSE`
- `CHANGELOG.md` — shows in marketplace "Changelog" tab
- `icon.png` — 128×128 minimum (no icon → rejected)
- `.vscodeignore` — exclude `src/`, `node_modules/`, `*.config.ts`, source maps, etc. (without it, extension ships with bundled `node_modules` ≈ 100MB)

### Publishing commands

```bash
cd editors/vscode

bun run build              # produce dist/extension.js
bunx vsce package          # creates codemap-vscode-X.Y.Z.vsix locally — INSPECT before publish
bunx vsce publish          # uploads to VSCode Marketplace (live in ~5 min)
bunx ovsx publish *.vsix   # uploads to Open VSX (Cursor / VSCodium / Theia users)
```

### CI publish workflow (recommended)

Tag-triggered (e.g. `vscode-v0.1.0` → `git tag vscode-v0.1.0 && git push --tags`):

```yaml
# .github/workflows/publish-vscode.yml
on:
  push:
    tags: ["vscode-v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - working-directory: editors/vscode
        run: bun run build
      - working-directory: editors/vscode
        run: bunx vsce publish -p ${{ secrets.VSCE_PAT }}
      - working-directory: editors/vscode
        run: bunx ovsx publish -p ${{ secrets.OVSX_PAT }}
```

GH secrets: `VSCE_PAT`, `OVSX_PAT`.

### Versioning relative to CLI

Two patterns. Fallow uses **locked** (extension version always matches CLI). Codemap should match:

- Locked → simpler users; one mental model; needs hand-bump or script in changeset hook
- Independent → extension iterates separately; needs "this extension version requires CLI ≥ X" docs

Bias: **locked**. Relevant to Q1 — monorepo workspaces makes locked versioning trivial via changesets; flat layout needs a hand-script.

### Stuff that bites people

- **PAT expiration** (1 year max, Microsoft enforces). Calendar reminder.
- **First publish review** (24-48h gate; subsequent versions are instant).
- **Extensions can't be unpublished** — only deprecated + hidden. Pick the name carefully (Q11).
- **`engines.vscode` too high** locks out old VSCode users for no reason. Use `^1.96.0`-ish, not the latest.
- **Cursor compatibility** — Cursor uses Open VSX by default; skipping Open VSX (Q12 = no) means Cursor users can't install codemap without manual `.vsix` install.

---

## Test approach

- **Unit:** each LSP handler (diagnostic, hover, code lens, code action) — `*.test.ts` per touched file (per [`verify-after-each-step`](../../.agents/rules/verify-after-each-step.md)).
- **Integration:** spin up the LSP server in a child process; send LSP messages over stdio; assert response shapes. `tower-lsp` style integration test (Bun side: roll our own; small surface).
- **Extension:** `vscode-test` (Microsoft's E2E test framework for extensions) — launch a VSCode instance with the extension loaded, open a fixture project, assert squigglies appear.
- **Golden fixture:** `fixtures/golden/lsp-fixture/` containing project that exercises each diagnostic-emitting recipe. Expected diagnostic count + locations per recipe codified in `scenarios.json`.

---

## Risks / non-goals

| Item                                                                            | Mitigation                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Non-goal:** standard LSP request handlers (definition / references).          | Per L.1; rejected.                                                                                                                                                                                                 |
| **Non-goal:** verdict-shaped CLI verb fronting the LSP server.                  | Per L.2; recipes drive output. The LSP binary is a transport, not a new verb.                                                                                                                                      |
| **Non-goal:** runtime tracing / live execution data.                            | Per [Floor "No runtime tracing"](../roadmap.md#floors-v1-product-shape). Static recipes only.                                                                                                                      |
| **Risk:** XL surface (~3-4k LoC) — slip risk.                                   | Slice cadence per § Implementation slices. Each slice is shippable (extension MVP works against one recipe before adding 5 more). If the plan stalls, partial slices still deliver.                                |
| **Risk:** marketplace approval delays first publish.                            | First publish = 24-48h review; plan slice 7 explicitly. Subsequent versions are instant.                                                                                                                           |
| **Risk:** extension vs CLI version drift.                                       | Locked versioning (per § Versioning); changeset hook bumps both. Q1 (monorepo) makes this trivial; flat layout needs a small script.                                                                               |
| **Risk:** false-positive squigglies on `untested-and-dead` for framework files. | (b) C.9 lands first per § 5 cadence; reduces FP class. Until then, extension settings let users disable specific diagnostic codes (mirrors fallow's `issueTypes`).                                                 |
| **Risk:** plan abandoned mid-iteration.                                         | Per [`docs/README.md` Rule 8](../README.md), close as `Status: Rejected (YYYY-MM-DD) — <reason>`. Design surface captured either way. Engines stay as-is; nothing extracted.                                       |
| **Risk:** binary size / startup time on user machines.                          | Bun-based binary is small (~10MB stripped); VSCode-bundled binary distribution mirrors fallow's pattern (one binary per platform; download lazily). Cold-start sub-100ms still applies on the LSP `did_open` path. |

---

## Cross-references

- [`docs/research/non-goals-reassessment-2026-05.md`](../research/non-goals-reassessment-2026-05.md) — research foundation: [§ 2.5 v3 verdict](../research/non-goals-reassessment-2026-05.md#25-no-lsp-replacement), [§ 5 pick-order rationale (the (d) v1 → v2 → v3 arc)](../research/non-goals-reassessment-2026-05.md#5-pick-order-rationale-historical), [§ 8 errata](../research/non-goals-reassessment-2026-05.md#8-triangulation-errata-2026-05). Moats lifted to [`roadmap.md § Non-goals (v1)`](../roadmap.md#non-goals-v1).
- [`docs/plans/c9-plugin-layer.md`](./c9-plugin-layer.md) — C.9 plan (lands before (d); sharpens (d)'s diagnostic precision via entry-point awareness)
- [`docs/architecture.md`](../architecture.md) — engine reference (`application/show-engine.ts`, `application/impact-engine.ts`, `application/watcher.ts`)
- [`docs/golden-queries.md`](../golden-queries.md) — golden-query test pattern (LSP fixture follows the same shape)
- [`docs/README.md` Rule 3](../README.md) — plan-file convention (this file's location)
- [`docs/README.md` Rule 10](../README.md) — agent rule lockstep update (Slice 8)
- [`.agents/rules/tracer-bullets.md`](../../.agents/rules/tracer-bullets.md) — slice cadence
- Reference implementations: [fallow `crates/lsp/`](https://github.com/fallow-rs/fallow/tree/main/crates/lsp), [fallow `editors/vscode/`](https://github.com/fallow-rs/fallow/tree/main/editors/vscode)
