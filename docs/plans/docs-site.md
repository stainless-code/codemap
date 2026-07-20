# Plan: Public docs site + Codemap brand

**Inspiration (infra + gotchas):** Persist [#20](https://github.com/stainless-code/persist/pull/20) (ship Blume site), [#21](https://github.com/stainless-code/persist/pull/21) (Bun workspaces + changesets), [#24](https://github.com/stainless-code/persist/pull/24) (docs-only → **patch**). Product shell + Blume patterns from Layers; **layout matches Persist** (publishable root + private `apps/docs`), not Layers `packages/*`.

Maintainer Tier-B surface (`docs/architecture.md`, glossary, plans, …) **stays**. Public site is a second surface (`apps/docs`). Do **not** dump `docs/*.md` wholesale into the site — curated lifts only ([`docs/README.md` Rule 1](../README.md)).

**Supersedes** the Fumadocs / flat `website/` sketch in [`lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) § monorepo triggers. Docs hosting is Blume + FTP at `/codemap`; that alone does **not** force a `packages/*` conversion (same conclusion as Persist).

---

## Agent start here

### Key touchpoints (after scaffold)

| File                                                      | Role                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/docs/`                                              | `@stainless-code/codemap-docs` (private Blume app)                                                 |
| `apps/docs/blume.config.ts`                               | title, nav IA, theme, Orama, `deployment.base: "/codemap"`                                         |
| `apps/docs/.oxfmtrc.json`                                 | `printWidth: 80`, ignore `content/**` (oxfmt `:::` bug)                                            |
| `package.json`                                            | `workspaces: [".", "apps/*"]`, `docs:*`, `homepage`, `overrides`                                   |
| `.changeset/config.json`                                  | `ignore: ["@stainless-code/codemap-docs"]`                                                         |
| `typedoc.json`                                            | Entry = published root (`src/index.ts` / package exports); out → `apps/docs/content/reference/api` |
| `apps/docs/scripts/rewrite-api-links.ts`                  | Port from Persist/Layers; clean + rewrite for `base: "/codemap"`                                   |
| `.github/workflows/ci.yml`                                | `docs` job (build → api → validate → check → build → audit)                                        |
| `.github/workflows/deploy-docs.yml`                       | FTP; `docs` label / release / `workflow_dispatch`                                                  |
| `.agents/skills/{docs-voice,product-tenets,update-docs}/` | Port from Persist; Codemap-tune                                                                    |

### Tracer bullet

Empty Blume site at `/codemap` builds → TypeDoc→MDX green under `/reference/api` → CI docs job → FTP secrets → first `docs`-labeled merge → then migrate README/guides.

### Out of scope (v1)

- Live interactive demos / WASM CLI / recipe runner in the browser (needs index/DB; revisit with `examples/` or playground)
- Moving CLI into `packages/codemap` / Layers-style private root
- Duplicating maintainer internals (`packaging.md`, golden policy, most of `architecture.md`)

### Verification

```bash
bun run docs:dev
bun run docs:api
bun run docs:validate -- --strict
bun run docs:check -- --isolated
bun run docs:build && bun run docs:audit
# After FTP secrets: workflow_dispatch or merge PR labeled `docs`
```

---

## Pre-locked decisions

| Decision           | Choice                                                                              | Why                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack              | Blume **1.1.0** pin (match Persist/Layers)                                          | Org pattern; Orama, OG, `llms.txt`, static FTP                                                                                                         |
| App location       | `apps/docs` as `@stainless-code/codemap-docs`                                       | Persist/Layers convention                                                                                                                              |
| Workspaces         | **`[".", "apps/*"]` from day one**                                                  | Persist #21: `apps/*` alone drops root from changesets                                                                                                 |
| Changeset ignore   | `@stainless-code/codemap-docs`                                                      | Private docs app never versioned                                                                                                                       |
| Docs-only bump     | **`patch`**                                                                         | Persist #24: not `minor`                                                                                                                               |
| Public URL         | `https://stainless-code.com/codemap`                                                | Org static host + subpath                                                                                                                              |
| README             | npm/repo landing digest only                                                        | Site is canonical user docs                                                                                                                            |
| Maintainer `docs/` | Unchanged role                                                                      | Governance Tier B stays                                                                                                                                |
| TypeDoc            | **Ship in-path** (Persist/Layers parity)                                            | Programmatic surface is public (`createCodemap`, config, adapters, types from `src/index.ts`) — same reason other stainless-code libs generate API MDX |
| Audit skips        | `canonical_bad_target`, `non_canonical_in_sitemap`, `indexable_page_not_in_sitemap` | Blume + `deployment.base` (same as Persist; drop `html_too_large` unless needed)                                                                       |
| lint-staged        | Include **`mdx`**                                                                   | Persist: content-only commits otherwise skip format                                                                                                    |
| oxfmt content      | Nested ignore `content/**`                                                          | Prevents collapsing `:::tip` / `:::note` ([Blume FAQ](https://useblume.dev/docs/faq#why-is-oxfmt--ultracite-collapsing-my-directives))                 |
| `path-to-regexp`   | Override `6.3.0` when `bun audit` high appears                                      | Persist/Layers; Blume transitive                                                                                                                       |

### Site config (`apps/docs/blume.config.ts`)

- `github`: `owner: stainless-code`, `repo: codemap`, `dir: apps/docs`
- `deployment`: `site: "https://stainless-code.com"`, `base: "/codemap"`
- `export: { epub: true, pdf: true }`
- `ai.llmsTxt: true` — add `markdownComponents` only when MDX islands exist
- `search.provider: "orama"` + `CURATED_POPULAR`
- `content.sources`: filesystem + `github-releases` → `/changelog`
- Theme: **distinct from Layers teal and Persist amber** — pick one accent in Slice 0 (cool blue/slate leaning toward Action `color: blue` is fine; lock tokens in `theme.css`)
- Brand one-liner (homepage + README): **“Query your codebase.”** (already `package.json` description lead)

### Navigation IA (Codemap-tuned)

| Tab       | Path         | Seeds from                                                                                                                                         |
| --------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guides    | `/guides`    | README install/CLI; `docs/agents.md` consumer parts; Action / CI                                                                                   |
| Recipes   | `/recipes`   | Bundled `--recipe` catalog (themes); not a second Examples tab                                                                                     |
| Concepts  | `/concepts`  | `why-codemap.md` (anti-pitch + alternatives); schema overview; index lifecycle; non-goals short                                                    |
| Reference | `/reference` | Hand: CLI flags, env, MCP tools/resources, formats/exit codes · **Generated:** TypeDoc MDX under `/reference/api` from the published package entry |

No **Adapters** tab (library seam matrix is Persist/Layers). Optional later: Benchmarks blurb (marketing only — full methodology stays in `docs/benchmark.md`).

Homepage sections (Layers/Persist shape, Codemap story): **Hero** (install + one SQL example) → **UseCases** (agent questions → one recipe) → **HowItWorks** (index → query → join) → **Batteries** (recipes / MCP / Action / agents init) → **FinalCta**.

### Content boundary (non-negotiable)

| Promote to site                              | Keep in maintainer `docs/`                                 |
| -------------------------------------------- | ---------------------------------------------------------- |
| Install, first query, recipe catalog         | `packaging.md`, `testing-coverage.md`, `golden-queries.md` |
| Why / vs alternatives (curated)              | Most of `architecture.md` Key Files / layering             |
| Agents init / MCP / HTTP (consumer)          | Plans, audits, research, agent-eval internals              |
| Config + Action + programmatic API (TypeDoc) | Benchmark methodology detail                               |

---

## Infra checklist (copy/adapt from Persist)

```text
apps/docs/
  package.json              # private, blume@1.1.0, audit script + skips
  blume.config.ts
  .oxfmtrc.json
  theme.css
  components.ts
  components/curated-popular.ts
  components/blume/{Footer,Pagination}.astro
  pages/index.astro + _home/*
  pages/404.astro
  public/{logo,icon,favicons,.htaccess}
  content/{guides,recipes,concepts,reference}/…
  content/reference/api/        # TypeDoc out (gitignore generated; keep hand index.mdx + meta.ts)
  scripts/rewrite-api-links.ts  # port from Persist/Layers
package.json                # workspaces [".", "apps/*"], docs:*, homepage, overrides
typedoc.json                # markdown+frontmatter → apps/docs/content/reference/api
.changeset/config.json      # ignore codemap-docs
lint-staged.config.js       # mdx in format glob
.github/workflows/ci.yml    # docs job
.github/workflows/deploy-docs.yml
.agents/skills/docs-voice|product-tenets|update-docs (+ priming/symlinks)
docs/README.md              # canonical public URL
.agents/skills/docs-governance/LIFECYCLE.md  # README surfaces → /codemap
```

**FTP (same org pattern):** secrets `FTP_HOST` / `FTP_USERNAME` / `FTP_PASSWORD`; account root scoped to `/codemap`; `local-dir: ./apps/docs/dist/`; `server-dir: ./`; concurrency `deploy-docs-production`; triggers = `docs` label on merged PR / release / `workflow_dispatch`. `.htaccess` ErrorDocument under `/codemap/`.

**CI docs job order:** `build` → `docs:api` → `docs:validate --strict` → `docs:check --isolated` → `docs:build` → `docs:audit`.

---

## Slices

### Slice 0 — Brand mark

1. Settled-signal logo + favicon set under `apps/docs/public/` (RFG or hand SVG).
2. Accent + light/dark tokens in `theme.css` (not Layers teal, not Persist amber).
3. Wordmark “Codemap” in header (`logo.image` + `logo.text`).

### Slice 1 — Empty docs site builds

1. Add `workspaces: [".", "apps/*"]` **and** changeset `ignore` for docs package in the **same** commit (don’t land `apps/*` alone).
2. Create `apps/docs`, pin `blume@1.1.0`, stub Guides landing, nested `.oxfmtrc.json`.
3. Root `docs:*` scripts; local `docs:dev` / `docs:build` / `docs:audit` green with `base: "/codemap"`.
4. lint-staged: add `mdx`.
5. `path-to-regexp` override if `bun audit` reports high.

### Slice 2 — TypeDoc → MDX (programmatic API)

Codemap is CLI-first **and** a library: `src/index.ts` re-exports `./api` (`createCodemap`, …), config (`defineConfig` / schemas), adapters (`LanguageAdapter`, `BUILTIN_ADAPTERS`, …), and types. Document that surface the same way Persist/Layers do.

1. Add `typedoc.json` (markdown + frontmatter plugins) → `apps/docs/content/reference/api`.
2. Scaffold names that never clobber hand-authored `index.mdx` / `meta.ts` (Persist: `_typedoc-entry.mdx` / `_typedoc-modules.mdx`).
3. Port `apps/docs/scripts/rewrite-api-links.ts`; wire `docs:api` = clean → typedoc → rewrite.
4. Hand-authored `content/reference/api/index.mdx` + `meta.ts` pointing at generated pages.
5. `treatWarningsAsErrors` / invalid `{@link}` gate; JSDoc on public exports is the SSOT for API pages.
6. Local `bun run docs:api` + site route `/reference/api` green.

### Slice 3 — CI + FTP deploy

1. CI `docs` job (pipeline above — includes `docs:api`).
2. `deploy-docs.yml` + `docs` label description.
3. `.htaccess` under `/codemap/`.
4. **Ops:** set FTP secrets (root scoped to `/codemap`) before first live deploy.
5. Smoke after first deploy: sitemap / `llms.txt` under `/codemap`; no leaked `_home` routes; API pages serve.

### Slice 4 — Content migration + README digest

1. Guides: getting-started, CLI overview, agents/MCP/HTTP, config, CI Action, programmatic quick start (link TypeDoc).
2. Recipes: catalog by theme (link params/formats; don’t invent new recipe SQL).
3. Concepts: why, when-to-skip, schema overview, lifecycle.
4. Reference hub: CLI / env / MCP / formats (hand) + link to generated `/reference/api`.
5. Slim root `README.md` to landing digest; `homepage` → `https://stainless-code.com/codemap`.
6. Changeset: **`patch`** for `@stainless-code/codemap`.

### Slice 5 — Homepage + chrome

1. Rich `_home` sections (Hero → UseCases → HowItWorks → Batteries → FinalCta).
2. Footer, Pagination override, `CURATED_POPULAR` for Cmd+K + 404.
3. `export` epub/pdf; github-releases changelog.

### Slice 6 — Agents + governance lift

1. Port Persist-tuned skills: `docs-voice`, `product-tenets`, `update-docs` (+ priming rules / `.cursor` symlinks per agents-first).
2. Codemap voice: CLI-first **and** programmatic; SQL-is-API; anti-pitch from `why-codemap.md`; **no** store/adapter competitor framing.
3. Update `docs-governance` LIFECYCLE README surfaces: site canonical; root README = npm landing; **`docs` label** → FTP `/codemap`.
4. Link site from `docs/README.md`; roadmap bullet can retire when this plan closes.
5. Lessons: workspaces `"."`, oxfmt content ignore, audit basePath skips, docs = patch.

---

## Gotchas (do not re-learn)

1. **`workspaces: ["apps/*"]` alone** → Release: “changeset … which is not in the workspace” ([Persist #21](https://github.com/stainless-code/persist/pull/21)).
2. **Docs-only changeset = `patch`** ([Persist #24](https://github.com/stainless-code/persist/pull/24)).
3. **oxfmt + `:::`** → ignore `content/**` + nested `printWidth: 80`.
4. **lint-staged without `mdx`** → format never runs on content commits.
5. **`bun audit` high on `path-to-regexp`** → override `6.3.0`.
6. **Blume cache after bump** → `rm -rf apps/docs/.blume apps/docs/.blume-verify`.
7. **Don’t couple to LSP monorepo** — docs app does not import `src/`; keep single publishable root until a real packaging trigger fires.

---

## Lift targets (when this plan closes)

| Destination                                   | Lift                                         |
| --------------------------------------------- | -------------------------------------------- |
| `docs/architecture.md` or `docs/packaging.md` | Public docs path, TypeDoc/`docs:api`, deploy |
| `docs/README.md`                              | Canonical public URL                         |
| `docs/roadmap.md`                             | Remove open “docs site” bullet               |
| `.agents/skills/docs-governance/LIFECYCLE.md` | README surfaces                              |
| `.agents/lessons.md`                          | Durable gotchas (if not already lifted)      |
| Delete                                        | This plan file                               |

---

## Reference

- Persist ship: https://github.com/stainless-code/persist/pull/20
- Persist workspaces fix: https://github.com/stainless-code/persist/pull/21
- Persist patch changeset: https://github.com/stainless-code/persist/pull/24
- Layers docs app (shell/patterns): `../layers/apps/docs` (sibling checkout)
- Org host: `https://stainless-code.com/{layers,persist}` → add `codemap`
- Blume oxfmt FAQ: https://useblume.dev/docs/faq#why-is-oxfmt--ultracite-collapsing-my-directives
