# CI output formats (CodeClimate + badge) — plan

> **Status:** shipped · **PR:** [#172](https://github.com/stainless-code/codemap/pull/172) · delete this plan on merge (lift lives in `architecture.md` + `glossary.md`)
>
> **Motivator:** `query --format` ships `sarif`, `annotations`, and `mermaid`. GitLab Code Quality ingestion expects [Code Climate JSON](https://docs.gitlab.com/ee/ci/testing/code_quality.html); README / CI summary badges need a compact pass/fail or issue-count line. Both are **output modes** on existing recipe rows — not new analysis primitives.
>
> **Roadmap:** [§ Recipe & audit enrichment](../roadmap.md#recipe--audit-enrichment)

---

## Agent start here

Copy **`formatSarif`** / **`formatAnnotations`** patterns in [`output-formatters.ts`](../../src/application/output-formatters.ts). Reuse **`detectLocationColumn`** — rows without locatable columns get same stderr warning as SARIF. Wire `codeclimate` first; `badge` second.

### Key touchpoints

| File                                                                                           | What to read                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`src/application/output-formatters.ts`](../../src/application/output-formatters.ts)           | `formatSarif`, `formatAnnotations`, `detectLocationColumn`, `FormatOpts` |
| [`src/application/output-formatters.test.ts`](../../src/application/output-formatters.test.ts) | Snapshot golden patterns                                                 |
| [`src/cli/cmd-query.ts`](../../src/cli/cmd-query.ts)                                           | `--format` validation list                                               |
| [`src/application/query-engine.ts`](../../src/application/query-engine.ts)                     | Format dispatch                                                          |
| [`src/application/tool-handlers.ts`](../../src/application/tool-handlers.ts)                   | MCP `format` enum                                                        |

### Architecture

```text
query --recipe X --format codeclimate|badge
  → query-engine rows
  → output-formatters.formatCodeClimate | formatBadge
  → stdout (GitLab artifact / README paste)
```

Moat A: formatters only — no new analysis.

### Tracer bullet (slice 1)

`formatCodeClimate` + snapshot test on `boundary-violations` fixture rows + `--format codeclimate` in CLI. Badge format in slice 2.

### Out of scope (v1)

`audit --format codeclimate`; shields.io network fetch; HTTP `/badge` endpoint; recipe frontmatter `severity:` (see F.7).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Source                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F.1 | **Two new format ids** — `codeclimate` and `badge` on `codemap query` / MCP `query` / `query_recipe` (same `output-formatters.ts` home as SARIF).                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [Moat A](../roadmap.md#moats-load-bearing) — output mode only                         |
| F.2 | **Code Climate shape** — JSON array of objects: `description`, `check_name`, `fingerprint`, `location.path`, `location.lines.begin` (`line_start` when present, else `1` for file-level rows), `severity` (`info`\|`minor`\|`major`\|`critical`\|`blocker`).                                                                                                                                                                                                                                                                                                                                       | [GitLab Code Quality format](https://docs.gitlab.com/ee/ci/testing/code_quality.html) |
| F.3 | **Fingerprint** — stable SHA-256 (16 hex) from `(recipe_id, file_path, line_start, check_name, row message)` so GitLab dedupes across runs but distinct same-file rows (e.g. boundary `to_path`) stay separate.                                                                                                                                                                                                                                                                                                                                                                                    | GitLab dedup semantics                                                                |
| F.4 | **Badge count source** — row count after location filtering (same rows Code Climate would emit); no network fetch in core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Output formatter only                                                                 |
| F.5 | **Location contract** — reuse `detectLocationColumn` from SARIF/annotations; skip rows without locatable columns (same stderr warning as SARIF aggregates).                                                                                                                                                                                                                                                                                                                                                                                                                                        | `output-formatters.ts`                                                                |
| F.6 | **Audit parity deferred** — v1 on `query`/`query_recipe` only; `audit --format codeclimate` follows if consumer asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tracer bullet                                                                         |
| F.7 | **Code Climate severity — flat `minor`** — every row gets `severity: "minor"` in v1; no recipe frontmatter `severity:` parsing. Matches SARIF's flat `level: "note"` (Moat A — presentation, not verdict). Agents triage via recipe id + `actions:` + JSON rows, not CI severity bands. `info` avoided — GitLab default widgets often hide it. Frontmatter `severity:` deferred to v1.x when a recipe needs differentiated GitLab sorting and the field is exposed in recipe catalog too.                                                                                                          | Grill-me Q1                                                                           |
| F.8 | **Badge — B-lite (`BadgeSummary` + dual serializers)** — internal `BadgeSummary` `{ label, message, count, status }` where `status` is `pass` when `count === 0` else `fail`, `message` is `clean` when zero else `` `${count} issue(s)` ``. **Default stdout:** markdown `codemap: <message>` (README / PR paste). **Opt-in:** `--badge-style json` emits `codemap-badge/v1`: `{ schema, label, message, count, status }`. Agents: triage via `query_recipe` JSON / `--summary`; paste markdown; CI gates read JSON `.count` / `.status`. Shields colors + HTTP `/badge` reuse this schema later. | Grill-me Q2                                                                           |

---

## Implementation steps

1. `formatCodeClimate(opts: FormatOpts): string` in `output-formatters.ts`.
2. `buildBadgeSummary(opts)` + `formatBadge` (markdown default) + `formatBadgeJson` (`codemap-badge/v1`; see F.8). CLI/MCP flag `--badge-style markdown|json` (default `markdown`).
3. Wire `--format codeclimate|badge` in `cmd-query.ts` + `tool-handlers.ts` (MCP/HTTP dispatch).
4. MCP/HTTP `format` enum extension + `badge_style` on query tools when `format=badge`.
5. Snapshot tests in `output-formatters.test.ts` — Code Climate golden JSON; badge markdown + `codemap-badge/v1` JSON goldens.
6. Docs — `architecture.md` output formatters §; README GitLab CI artifact example; agent note: badge is presentation — use JSON rows for triage.

---

### Verification

```bash
bun test src/application/output-formatters.test.ts
bun src/index.ts query --recipe boundary-violations --format codeclimate
bun src/index.ts query --recipe boundary-violations --format badge
bun src/index.ts query --recipe boundary-violations --format badge --badge-style json
# Run formatter output through GitLab Code Quality schema validator if available
```

---

## Acceptance

- [x] `codemap query --recipe boundary-violations --format codeclimate` emits valid GitLab-ingestible JSON
- [x] Fingerprints stable across two runs with identical rows
- [x] `badge` markdown: `codemap: N issues` / `codemap: clean` for N>0 and N=0
- [x] `badge --badge-style json` emits stable `codemap-badge/v1` with matching `count` / `status`
- [x] Incompatible with `summary` / `group_by` / `baseline` (same rules as SARIF)

---

## Dependencies

- Shipped: `formatSarif`, `formatAnnotations`, location detection
- Independent of audit attribution / coverage recipes
