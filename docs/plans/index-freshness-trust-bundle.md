# Index freshness trust bundle — plan

> **Status:** in progress · **Priority:** agent session · **Effort:** S (~3–5 days) · **Roadmap:** [§ Index staleness surfacing](../roadmap.md#agent-session--warm-path-economics), [§ HEAD / index freshness warning](../roadmap.md#agent-session--warm-path-economics)
>
> **Motivator:** Agents treat MCP / HTTP / `context` output as ground truth. Today they can query during watcher debounce (disk ahead of index), after a branch switch (`last_indexed_commit` ≠ `HEAD`), or with a dirty working tree when watch is off — with no signal except running `validate` manually. Wrong structural verdicts follow.

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                              | Source                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| L.1 | **`index_freshness` is metadata, not a verdict** — structured fields + optional `warning` string; never `pass`/`fail`.                                                                                | [Moat A](../roadmap.md#moats-load-bearing)                        |
| L.2 | **Canonical shape in one module** — `src/application/index-freshness.ts`; `context`, MCP, HTTP, and CLI all call `computeIndexFreshness()`.                                                           | Same seam as `validate-engine` / `context-engine`                 |
| L.3 | **`pending_sync` = watcher queue OR in-flight reindex** — true when debouncer has paths **or** a targeted `--files` reindex is running. Not “SQLite mid-transaction” (writes stay transactional).     | [roadmap § No split-brain](../roadmap.md#floors-v1-product-shape) |
| L.4 | **Cheap vs full freshness** — every transport gets cheap signals (HEAD drift, pending sync, watch active). **Disk drift** (`getChangedFiles`) runs on `context` and opt-in full mode only (git cost). | Avoid git subprocess on every `query` row                         |
| L.5 | **JSON tool payloads stay backward-compatible in v1 slice** — slice 1 enriches `context` only; slice 2 adds HTTP headers + MCP `_meta` wrapper without breaking array-shaped `query` results.         | Agent eval / golden harness consume raw arrays today              |

---

## Freshness envelope

```typescript
interface IndexFreshness {
  head_commit: string | null;
  last_indexed_commit: string | null;
  commit_drift: boolean;
  watch_active: boolean;
  pending_sync: boolean;
  pending_paths: number;
  reindex_in_flight: boolean;
  /** Present when `include_disk_drift: true` */
  disk_ahead_of_index?: boolean;
  unindexed_change_count?: number;
  history_incompatible?: boolean;
  /** Single agent-readable line when any concern is active; null when fresh */
  warning: string | null;
}
```

---

## Shipping cadence (tracer bullets)

### Slice 1 — `context` + watcher state (this PR)

1. **`getWatchSyncState()`** on `watcher.ts` — expose debouncer pending count + reindex-in-flight flag (module-scoped; test reset hook).
2. **`index-freshness.ts`** — `computeIndexFreshness(db, { include_disk_drift })`.
3. **`ContextEnvelope.index_freshness`** — `buildContextEnvelope` calls full mode (`include_disk_drift: true`).
4. **CLI `codemap context`** — inherits via `buildContextEnvelope` (no separate code path).
5. **Unit tests** — freshness permutations (drift, pending, disk-ahead, history rewrite).
6. **Docs** — one paragraph in [`agents.md`](../agents.md) + roadmap checkbox note when shipped.

**Acceptance**

- [ ] `codemap context --json` includes `index_freshness` with `warning` when HEAD ≠ `last_indexed_commit`
- [ ] Fake watcher with pending debounce → `pending_sync: true`
- [ ] Non-git fixture → `head_commit: null`, no throw

### Slice 2 — all MCP / HTTP tool responses

1. **HTTP response headers** on `POST /tool/*`: `X-Codemap-Pending-Sync`, `X-Codemap-Commit-Drift`, `X-Codemap-Warning` (when set).
2. **MCP `wrapToolResult`** — for JSON tools, wrap as `{ result, index_freshness }` **or** append a second `content` block with type `text` prefixed `@codemap/index_freshness` (pick in plan-PR review; default: wrapper object for object payloads, header-equivalent second block for arrays — document in MCP instructions).
3. **`/health`** — include cheap freshness when DB exists (optional).

### Slice 3 — stderr + MCP initialize (optional)

1. **`codemap mcp` / `serve` boot** — one-line stderr when commit drift detected at prime time.
2. **MCP `instructions` / `codemap://mcp-instructions`** — document freshness fields + agent guidance (“if `pending_sync`, retry after debounce or call `validate`”).

---

## Dependencies

- [`watcher.ts`](../../src/application/watcher.ts) — debouncer + `isWatchActive()`
- [`index-engine.ts`](../../src/application/index-engine.ts) — `getChangedFiles`, `getCurrentCommit`
- [`context-engine.ts`](../../src/application/context-engine.ts) — envelope builder
- [`validate-engine.ts`](../../src/application/validate-engine.ts) — conceptual sibling (per-file staleness vs index-level)

---

## Out of scope

- Blocking queries when stale (agents decide).
- Changing incremental indexing semantics ([No split-brain floor](../roadmap.md#floors-v1-product-shape)).
- Shared daemon / multi-session lifecycle (separate roadmap item).
