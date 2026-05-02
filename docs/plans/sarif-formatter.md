# SARIF + GH-annotations output formatters (B.8)

> **Status:** in progress · **Issue / backlog:** [`research/fallow.md` § B.8](../research/fallow.md). Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Add `--format <text|json|sarif|annotations>` to `codemap query` so any recipe row-set can be piped into:

- **SARIF** — GitHub Code Scanning (and any SARIF-aware viewer) without writing a custom Action wrapper.
- **GH annotations** — `::warning|notice file=…,line=…::msg` so PR diffs surface findings inline.

Pure output-formatter additions on top of the existing JSON pipeline; no schema impact.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Location auto-detection.** Look for `file_path` / `path` / `to_path` / `from_path` (priority order) for `artifactLocation.uri`; `line_start` (+ optional `line_end`) for `region`. Recipes without a location column emit `results: []` (SARIF) or no output (annotations) + a stderr warning.                           |
| D2  | **`rule.id` taxonomy.** `codemap.<recipe-id>` for `--recipe`; `codemap.adhoc` for ad-hoc SQL (no flag wrangling for v1).                                                                                                                                                                                                   |
| D3  | **`rule.shortDescription`.** Recipe `description` from the catalog. **`rule.fullDescription`.** Body of `<id>.md`.                                                                                                                                                                                                         |
| D4  | **`result.message.text`.** Stringify non-location columns; if `name` present, lead with it (e.g. `"foo (function): @deprecated since v2"`).                                                                                                                                                                                |
| D5  | **`result.level`.** Default `"note"`. Per-recipe severity defers to B.5 audit verdict feature; recipes can opt in via frontmatter `sarifLevel:` later.                                                                                                                                                                     |
| D6  | **Empty result set.** Always emit a valid SARIF doc with `results: []` (SARIF tools handle empty). Annotations: no output.                                                                                                                                                                                                 |
| D7  | **Annotations format.** `::notice file=<path>,line=<n>::<msg>` (or `::warning` / `::error` per future `sarifLevel` mapping). One line per row.                                                                                                                                                                             |
| D8  | **Engine layer.** New `src/application/output-formatters.ts` — pure transport-agnostic, `formatSarif({rows, recipeId, recipeDescription, recipeBody?})` + `formatAnnotations({rows, recipeId})`. Wired into `cmd-query.ts` only; MCP `query` / `query_recipe` tools accept `format: "sarif" \| "annotations"` in tracer 5. |
| D9  | **Flag precedence.** `--format` overrides `--json`. Default = `text`. `--json` stays as alias for `--format json`.                                                                                                                                                                                                         |
| D10 | **Recipe overrides** (`sarifLevel`, `sarifMessage`, `sarifRuleId`) deferred to v1.x — only when a real consumer asks. Default formatters cover all 10 location-bearing recipes.                                                                                                                                            |

## Tracers

| #   | Slice                                                                                                                                                   | Acceptance                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `--format` flag parser in `cmd-query.ts`; enum + tests; rejects unknown values; falls through to existing `text` / `json` paths                         | `parseQueryRest` returns the format; no formatter wired yet                                                 |
| 2   | `formatSarif` in `application/output-formatters.ts`; `cmd-query.ts` uses it for `--format sarif`; one recipe verified end-to-end (`deprecated-symbols`) | `codemap query --recipe deprecated-symbols --format sarif` emits a valid SARIF 2.1.0 doc                    |
| 3   | `formatAnnotations`; `cmd-query.ts` uses it for `--format annotations`                                                                                  | `codemap query --recipe deprecated-symbols --format annotations` prints `::notice file=…,line=…::…` per row |
| 4   | Edge cases: ad-hoc SQL (`codemap.adhoc` rule id); aggregate recipes (no location column → empty results + stderr warning)                               | `index-summary` + `markers-by-kind` skipped cleanly; ad-hoc SQL gets `codemap.adhoc`                        |
| 5   | MCP integration: `query` / `query_recipe` tools accept `format` argument; same envelope on the wire                                                     | MCP `query_recipe` with `format: "sarif"` returns the SARIF doc as a string payload                         |
| 6   | Docs: README CLI section, agent rule + skill (`.agents/` + `templates/agents/` per Rule 10), `glossary.md` (`SARIF`, `annotations`), changeset (minor)  | All four files updated; bun audit / format / lint / test green                                              |

## Out of scope

- Per-recipe `sarifLevel` / `sarifMessage` / `sarifRuleId` frontmatter (D10).
- SARIF code-flow / threadFlow / fixes — codemap doesn't own behavior to fix (per `D14` in fallow.md).
- Multi-tool runs in one SARIF (one `runs[]` entry per CLI invocation; multiple recipes need a wrapper).
