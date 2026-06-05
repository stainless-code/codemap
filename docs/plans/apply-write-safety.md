# Apply write-safety hardening — plan

> **Status:** open · **Priority:** P2 · **Effort:** L (~1–2 weeks)
>
> **Motivator:** `codemap apply` already validates line content in phase 1 and writes via sibling temp + `rename`, but the module documents a **TOCTOU window** (phase-1 cache → phase-2 write without re-read) and omits `fsync` before promote. Agent-driven apply runs (recipe → dry-run → `--yes`) need stronger guarantees that disk did not change between validation and write, plus explicit skips for unsafe EOL states.
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform) · extends shipped [Apply engine](../architecture.md#apply--input-modes-transport-and-policy)

---

## Agent start here

Read the **TOCTOU** and **EOL** comments at the top of [`apply-engine.ts`](../../src/application/apply-engine.ts) — this plan retires the TOCTOU bullet. Implement hash cache + phase-2 recheck first; `fsync` + mixed-EOL second. All transports use the same engine.

### Key touchpoints

| File                                                                                 | What to read                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`src/application/apply-engine.ts`](../../src/application/apply-engine.ts)           | Phase 1 cache, phase 2 write loop, `ConflictReason` |
| [`src/hash.ts`](../../src/hash.ts)                                                   | `hashContent` (SHA-256) — use this, not xxh3        |
| [`src/application/apply-run.ts`](../../src/application/apply-run.ts)                 | CLI/MCP entry to engine                             |
| [`src/cli/cmd-apply.ts`](../../src/cli/cmd-apply.ts)                                 | `--yes` gating                                      |
| [`src/application/apply-engine.test.ts`](../../src/application/apply-engine.test.ts) | Conflict fixtures                                   |
| [`docs/architecture.md`](../architecture.md)                                         | § Apply — update after implementation               |

### Architecture

```text
apply / apply_rows / apply_diff_input
  → apply-engine phase 1: read file → hashContent + mixed-EOL check → cache
  → dry-run OR conflicts → stop
  → phase 2: re-read → hash compare → transform cache → temp write → fsync → rename
```

### Tracer bullet (slice 1)

Extend `sourceCache` with `contentHash`; phase-2 mismatch → `file content changed` conflict; test simulating disk edit between phases. Ship before `fsync` / mixed-EOL if schedule tight (document partial state in PR).

### Out of scope (v1)

Cross-file rollback on phase-2 failure; BOM round-trip policy (Q2); adversarial locking.

---

## Current state (shipped)

See [`architecture.md` § Apply](../architecture.md#apply--input-modes-transport-and-policy) and the TOCTOU / EOL comments in [`apply-engine.ts`](../../src/application/apply-engine.ts). **Open (this plan):** content-hash recheck before write, `fsync` before `rename`, mixed CRLF/LF skip. Cross-file rollback stays deferred per architecture § Apply.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                      | Source                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| W.1 | **Hash at capture** — on first phase-1 read per file, store `hashContent(source)` via existing `src/hash.ts` (SHA-256).                                                                                                       | Project hash convention                    |
| W.2 | **Recheck immediately before write** — phase 2 re-reads file (or compares hash of disk vs cached hash); mismatch → conflict `file content changed` for that file's rows; **abort entire apply** (preserve Q2 all-or-nothing). | Closes documented TOCTOU gap               |
| W.3 | **Atomic promote** — `writeFileSync` → `fsync` (or `fdatasync`) on temp handle → `renameSync`; preserve mode bits where practical (`lstat` before write).                                                                     | Crash-safe promote                         |
| W.4 | **Mixed line endings** — if file contains both `\r\n` and bare `\n` (excluding trailing file newline edge cases per impl PR), skip file with conflict reason `mixed line endings` — no silent corruption.                     | EOL safety                                 |
| W.5 | **Envelope extension** — new `ConflictReason` values: `file content changed`, `mixed line endings`; optional per-file `skip_reason` on `ApplyFile` when whole file skipped.                                                   | Q5 envelope stability                      |
| W.6 | **Cross-file rollback stays deferred** — per-file atomicity + pre-write hash guard is v1 scope; full transaction log out of scope.                                                                                            | [architecture § Apply](../architecture.md) |

---

## Implementation steps

1. Extend `sourceCache` to `Map<string, { source: string; contentHash: string }>` in `apply-engine.ts`.
2. Add `detectMixedLineEndings(source: string): boolean` helper + unit tests (CRLF-only, LF-only, mixed).
3. Phase-1: after read, run mixed-EOL check; fail rows for that file early.
4. Phase-2 loop: before transforms, `readFileSync` + `hashContent`; compare to cached hash → conflict or proceed.
5. Replace bare `writeFileSync` with open/write/fsync/close or `writeFileSync` + `fsyncSync(fd)` on temp path; then `renameSync`.
6. Update `apply-engine.test.ts` + `cmd-apply.test.ts` — simulate concurrent edit between phases (mock or temp file rewrite).
7. Document in `architecture.md` § Apply — retire TOCTOU bullet; list new conflict reasons in `glossary.md` § `codemap apply`.
8. MCP `apply` / `apply_rows` / `apply_diff_input` inherit via shared engine (no transport changes).

---

### Verification

```bash
bun test src/application/apply-engine.test.ts src/cli/cmd-apply.test.ts
bun src/index.ts apply <recipe> --dry-run
# rewrite file on disk between dry-run and --yes → expect file content changed conflict
```

---

## Acceptance

- [ ] Edit file on disk after dry-run passes but before `--yes` apply → `file content changed`, zero files modified
- [ ] Mixed-EOL fixture file → `mixed line endings`, no write
- [ ] Happy path unchanged: valid apply still returns `applied: true`
- [ ] `destructiveHint` apply tools document recheck behavior in tool description (synergy with [architecture.md § MCP wiring](../architecture.md) ToolAnnotations)

---

## Open decisions (impl PR)

| #   | Question                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------- |
| Q1  | Re-read full file vs hash-only compare (hash-only cheaper; re-read safer if hash collision concern irrelevant). |
| Q2  | BOM preservation — strip/re-emit UTF-8 BOM on round-trip?                                                       |
| Q3  | Per-file skip vs whole-run abort when one file fails hash recheck (default: whole-run abort per W.2).           |

---

## Dependencies

- Shipped: `apply-engine.ts`, `apply-run.ts`, `hashContent`, apply confirmation gates (`--yes`)
- Synergy: [evidence-chains-on-recipe-rows](./evidence-chains-on-recipe-rows.md) (agents should dry-run then apply with safety net)
