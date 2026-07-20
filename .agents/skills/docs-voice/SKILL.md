---
name: docs-voice
description: Voice, tone, and format for the public Codemap docs (`apps/docs`, built with Blume). Use when authoring or editing apps/docs prose — landing, guides, concepts, recipes, reference, generated API — or deciding headline grammar, benefit framing, peer framing, or anti-pitch wording.
---

# Docs voice — Codemap docs (`apps/docs`, built with Blume)

Keep landing, guides, concepts, recipes, reference, and generated API reading like one voice.

## Voice in one line

Senior-dev to senior-dev: concrete, SQL-literate, dry, honest about scope. No
hype. The differentiators are radical honesty (say what's planned / diverges /
was rejected) and the "when **not** to use it" anti-pitch — keep both.

## Do

- **Lead with the pain, then the mechanism.** "Agents burn tokens scanning files
  to find one symbol…" → then "`codemap query --json` returns the row in one SQL
  round-trip."
- **Concrete before abstract.** Name `codemap query` / `--recipe` / `createCodemap`
  / `defineConfig` before the coinage "predicate-as-API" or "structural index."
- **CLI-first AND programmatic.** Show the CLI shape first; pair with the library
  shape (`createCodemap`, `defineConfig`, adapters) when the page is API-shaped.
  The published package entry is the SSOT for generated `/reference/api` (TypeDoc).
- **SQL is the API.** When a page answers a structural question, show the SQL or
  the `--recipe` — not a paragraph of prose pretending to be the answer. Recipes
  are named SQL patterns; cite the recipe id.
- **Section headers by page type.** Marketing = period-terminated benefit
  sentence ("Query your codebase."); guides = action verb ("Find a symbol with
  one query"); reference = precise noun; concepts = model noun + consequence.
- **Card titles = the outcome; card bodies = the API / SQL.**
- **One idea per sentence in leads.** Short claim first, then expand.
- **State experimental / pre-1.0 status once per surface, one wording** (see
  Canonical patterns).
- **Sidebar icons: all-or-none per sibling list.** Blume does not reserve an
  icon column — sparse `sidebar.icon` jaggeds labels. Guides, Concepts,
  Recipes, Reference leaves: none unless every peer has a natural glyph.
  Section `meta.ts` icons and tab icons stay.
- **Peer framing is structural, not brand-vs-brand.** When comparing, contrast
  axes (query API, semantic layer, extraction depth, CI substrate) — see
  [`docs/why-codemap.md`](../../../docs/why-codemap.md) § Codemap vs alternatives.
  Do not clone peer design in prose; reach for the underlying spec
  ([`plan-pr-inspiration-discipline`](../../rules/plan-pr-inspiration-discipline.md)).

## Don't

- Don't open a page with a 60+ word sentence.
- Don't restate the frontmatter `description` in the first body sentence — the
  docs site renders `description` as the page subtitle, so an echoing opener
  duplicates content. Open with a concrete scenario/pain instead.
- Don't title cards with bare feature nouns ("Fan-in") when the outcome is the
  hook ("Find what depends on a file in one query").
- Don't manufacture social proof, download counts, "trusted by", or maturity
  adjectives ("production-grade", "battle-tested", "world-class") at pre-1.0 —
  live queries, source, the changelog, and the benchmark are the proof.
- Don't claim Codemap owns semantic search, refactoring, or editor ergonomics —
  peers (LSP, embeddings, verdict linters) own those slots; Codemap owns
  structural facts + predicate-as-API. Say when to reach for something else.
- Don't hype ("blazing-fast", "revolutionary", "AI-powered"). Indexed queries
  are sub-ms; let the number and the benchmark carry it.
- Don't treat store/adapter middlewares as competitors — different problem
  space. Codemap's peers are code-index / agent-context tools; the contrast is
  structural-SQL + recipes vs pre-baked graph verbs / embeddings.
- Don't invent Lucide icons for prose nav leaves to "fill out" a section —
  strip to none instead of decorating half the list.
- Don't paste maintainer internals (`src/` module names, CI wiring, dual-file
  sync, dogfood paths) into public pages — see
  [`consumer-surfaces`](../../rules/consumer-surfaces.md).

## Canonical patterns (use verbatim)

- **Experimental disclaimer** (banner / pill / callout / stability page):
  "Experimental — the API may change between minor releases. Pin your version."
- **Pre-1.0 semver:** breaking changes are expected and ship in **minor
  releases** (`0.x` → `0.y`), **not majors**. Schema-breaking changes that force
  a `.codemap/index.db` rebuild are the trigger for `minor`; everything else
  (additive CLI, public types, docs) is `patch`.
- **Brand one-liner** (memorable beat, not hype): "Query your codebase."
- **Category label** (what it is — pair with the brand beat, then the
  mechanism): "local codebase intelligence" / "codebase intelligence tool".
  Same breath as SQLite / SQL / recipes — never as a standalone slogan.
- **Public site URL:** `https://stainless-code.com/codemap` (canonical user
  docs). Root `README.md` is the npm landing digest; maintainer `docs/` is
  separate.
- **Peer set:** other codebase intelligence / code-index / agent-context tools
  — static-analysis linters (knip / ts-prune / jscpd / ESLint), Aider RepoMap,
  LSP servers, and the SQLite-backed cohort (srclight, ctxpp, KotaDB, …). Not
  store/adapter middlewares.
- **Anti-pitch source of truth:** [`docs/why-codemap.md`](../../../docs/why-codemap.md)
  § When to reach for something else — link, don't restate.

## Product tenets

Decisions and messaging should align with [`product-tenets`](../product-tenets/SKILL.md).

## Verify

`content/**` MDX is excluded from oxfmt (nested `.oxfmtrc.json` ignores
`content/**` — the `:::` directive collapse bug); `.astro` is not oxfmt-managed.
Build green before commit ([`verify-after-each-step`](../../rules/verify-after-each-step.md)):

```bash
bun run docs:validate -- --strict && bun run docs:check -- --isolated && bun run docs:build && bun run docs:audit
```

Scheduled drift sync: [`update-docs`](../update-docs/SKILL.md).

## Reference

- Priming: [`docs-voice-priming`](../../rules/docs-voice-priming.md)
- Tenets: [`product-tenets`](../product-tenets/SKILL.md)
- Lifecycle / README surfaces: [`docs-governance`](../docs-governance/SKILL.md)
- Anti-pitch + peer framing: [`docs/why-codemap.md`](../../../docs/why-codemap.md)
- Consumer-vs-maintainer split: [`consumer-surfaces`](../../rules/consumer-surfaces.md)
