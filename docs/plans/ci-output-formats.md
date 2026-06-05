# CI output formats (CodeClimate + badge) — plan

> **Status:** open · **Priority:** P3 · **Effort:** S–M (~1–2 weeks)
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

`audit --format codeclimate`; shields.io network fetch; formatters reading recipe frontmatter `severity` unless Q1 resolves in slice 1.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                       | Source                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| F.1 | **Two new format ids** — `codeclimate` and `badge` on `codemap query` / MCP `query` / `query_recipe` (same `output-formatters.ts` home as SARIF).                                                                              | [Moat A](../roadmap.md#moats-load-bearing) — output mode only                         |
| F.2 | **Code Climate shape** — JSON array of objects: `description`, `check_name`, `fingerprint`, `location.path`, `location.lines.begin`, `severity` (`info`\|`minor`\|`major`\|`critical`\|`blocker`).                             | [GitLab Code Quality format](https://docs.gitlab.com/ee/ci/testing/code_quality.html) |
| F.3 | **Fingerprint** — stable hash from `(recipe_id, file_path, line_start, check_name)` (FNV-1a or SHA-256 truncated) so GitLab dedupes across runs.                                                                               | GitLab dedup semantics                                                                |
| F.4 | **Badge format** — single-line markdown or shields-compatible JSON snippet: `codemap: N issues` derived from row count (or `--summary` count when composed). No network fetch in core — consumers paste into README workflows. | Output formatter only                                                                 |
| F.5 | **Location contract** — reuse `detectLocationColumn` from SARIF/annotations; skip rows without locatable columns (same stderr warning as SARIF aggregates).                                                                    | `output-formatters.ts`                                                                |
| F.6 | **Audit parity deferred** — v1 on `query`/`query_recipe` only; `audit --format codeclimate` follows if consumer asks.                                                                                                          | Tracer bullet                                                                         |

---

## Implementation steps

1. `formatCodeClimate(opts: FormatOpts): string` in `output-formatters.ts`.
2. `formatBadge(opts: FormatOpts): string` — param `badge_style: markdown|json` optional on query flags.
3. Wire `--format codeclimate|badge` in `cmd-query.ts` + `query-engine.ts` validation list.
4. MCP/HTTP `format` enum extension + tool description one-liner.
5. Snapshot tests in `output-formatters.test.ts` (fixture rows → golden JSON).
6. Docs — `architecture.md` output formatters §; README one example for GitLab CI artifact upload.

---

### Verification

```bash
bun test src/application/output-formatters.test.ts
bun src/index.ts query --recipe boundary-violations --format codeclimate
bun src/index.ts query --recipe boundary-violations --format badge
# Run formatter output through GitLab Code Quality schema validator if available
```

---

## Acceptance

- [ ] `codemap query --recipe boundary-violations --format codeclimate` emits valid GitLab-ingestible JSON
- [ ] Fingerprints stable across two runs with identical rows
- [ ] `badge` format returns deterministic single-line summary for N>0 and N=0
- [ ] Incompatible with `summary` / `group_by` / `baseline` (same rules as SARIF)

---

## Open decisions (impl PR)

| #   | Question                                                               |
| --- | ---------------------------------------------------------------------- |
| Q1  | Map recipe severity from frontmatter `severity:` field when present?   |
| Q2  | `badge` as markdown only, or also `codemap-badge/v1` JSON for shields? |

---

## Dependencies

- Shipped: `formatSarif`, `formatAnnotations`, location detection
- Independent of audit attribution / coverage recipes
