# Unresolved calls staging — plan

> **Status:** open · **Priority:** P2 · **Effort:** L (~2–3 weeks)
>
> **Motivator:** Call sites are inserted during parse; cross-file resolution to callee symbols happens in bindings post-pass without a durable staging queue. Re-indexing a subset of files can leave stale call edges until full rebuild. A two-phase extract→resolve pipeline enables scoped re-resolution on incremental sync.
>
> **Roadmap:** [§ Agent & indexing ops — P2](../roadmap.md#agent--indexing-ops)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                 | Source                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| L.1 | New table **`unresolved_calls`** — staging queue analogous to pending refs: caller location, callee name, file, kind.                                    | Substrate               |
| L.2 | **Phase 1 (parse):** insert calls + queue unresolved targets. **Phase 2 (resolve):** batch bind → update `bindings` / mark resolved / delete queue rows. | Two-phase               |
| L.3 | **Scoped resolve on `--files`:** only re-resolve queue entries touching changed files.                                                                   | Incremental correctness |
| L.4 | Expose **`unresolved-call-sites`** and **`call-resolution-stats`** recipes.                                                                              | Moat A                  |

---

## Schema sketch

```sql
CREATE TABLE unresolved_calls (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  caller_scope TEXT,
  callee_name TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  column_start INTEGER,
  reference_kind TEXT,
  created_at TEXT
);
```

---

## Implementation steps

1. SCHEMA_VERSION bump + DDL
2. Parser emits unresolved entries when callee not locally defined
3. **`src/application/call-resolver.ts`** — batch pass using imports + bindings + name match
4. Wire into `index-engine.ts` — full rebuild resolves all; incremental resolves scoped set
5. Delete or archive unresolved rows after pass (retain failed count in meta)
6. Recipes + golden tests
7. Fix any `indexFiles`-without-resolve gap (parity with full index)

---

## Acceptance

- [ ] Incremental `--files` re-resolves calls for touched files only
- [ ] Recipe lists remaining unresolved sites
- [ ] Full rebuild clears queue (or reports residual count)

---

## Dependencies

- Pairs with [callback-dispatch-synthesis](./callback-dispatch-synthesis.md) (runs after base resolve)
- [agents.md](../agents.md) — concurrent index safety via `<state-dir>/index.lock` / `codemap unlock`
