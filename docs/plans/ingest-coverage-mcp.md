# Ingest coverage — MCP/HTTP parity — plan

> **Status:** open · **Priority:** P1 (transport parity) · **Effort:** S (~1 day)
>
> **Motivator:** Coverage-aware recipes (`worst-covered-exports`, `files-by-coverage`, `untested-and-dead`) need `coverage` table rows. CLI has `codemap ingest-coverage`; MCP-only agents cannot load artifacts without shelling out.
>
> **Roadmap:** transport parity (agent-relevant core)

---

## Pre-locked decisions

| #   | Decision                                                                                               | Source                     |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| I.1 | **Thin transport twin** — same `IngestResult` envelope as CLI `--json`; no new semantics.              | Transport-agnostic engines |
| I.2 | **Lift orchestration** to `application/ingest-coverage-run.ts`; CLI `cmd-ingest-coverage.ts` calls it. | `architecture.md` layering |
| I.3 | **Tool name** `ingest_coverage` (snake_case MCP); HTTP `POST /tool/ingest_coverage`.                   | MCP convention             |
| I.4 | **Args:** `path` (required), `runtime` (optional, V8 dir), mirrors CLI flags.                          | CLI parity                 |
| I.5 | **No human text mode** on MCP — JSON only (infra output format excluded).                              | Agent transport            |

---

## Implementation steps

1. Extract `runIngestCoverage` + path resolvers from `cmd-ingest-coverage.ts` → `ingest-coverage-run.ts`
2. `handleIngestCoverage` in `tool-handlers.ts`
3. Register MCP tool + HTTP dispatch + `MCP_TOOL_NAMES` allowlist
4. Tests: `ingest-coverage-run.test.ts` (minimal), `tool-handlers.test.ts` smoke
5. Update `cmd-mcp.ts` help, `mcp-instructions.md`, `architecture.md` apply/coverage wiring

---

## Acceptance

- [x] MCP `ingest_coverage` ingests Istanbul fixture → `coverage` rows queryable
- [x] CLI `ingest-coverage` unchanged behavior (refactor only)
- [x] HTTP `POST /tool/ingest_coverage` returns same JSON as CLI `--json`
