# PR 2 — impact `inPath` homonym scoping

> **Status:** open (in progress) · **PR:** 2 of 3 · **Effort:** S–M
>
> **Orchestrator:** [`security-hardening-orchestrator.md`](./security-hardening-orchestrator.md)
>
> **Motivator:** `findImpact` resolves homonym symbols but walks call graph by name only — wrong blast-radius. Align with shipped `define_in` (#165) and existing `show`/`trace` `inPath` patterns. Moat B substrate fidelity.

---

## Agent start here

### Key touchpoints

| File                                   | What                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/application/impact-engine.ts`     | `inPath` on `FindImpactOpts`, per-file walks, `scopeFiles` |
| `src/cli/cmd-impact.ts`                | `--in <path>` flag                                         |
| `src/cli/cmd-composers.ts`             | MCP/CLI composer wiring                                    |
| `src/application/tool-handlers.ts`     | HTTP/MCP `impact` handler                                  |
| `src/application/mcp-server.ts`        | Tool schema `in` param                                     |
| `src/application/trace-engine.test.ts` | Homonym test patterns to mirror                            |

### Architecture

```text
findImpact({ target, inPath? })
  → resolveTarget → matched_in[]
  → if inPath set and ∉ matched_in → empty + skip reason
  → if homonym (|matched_in| > 1) and no inPath → walk per defining file, merge/dedup
  → walkCalls: scopeFiles filters call-site file_path
```

---

## Task list

| ID  | Task                                                 | Status   | Verify                                           |
| --- | ---------------------------------------------------- | -------- | ------------------------------------------------ |
| 4.1 | `inPath?: string` on `FindImpactOpts` / `findImpact` | **done** | `bun test src/application/impact-engine.test.ts` |
| 4.2 | Multi `matched_in` → per-file walks; merge/dedup     | **done** | homonym fixture                                  |
| 4.3 | `inPath` ∉ `matched_in` → empty + skip reason        | **done** | test                                             |
| 4.4 | Walkers: `scopeFiles` on call-site file              | **done** | test                                             |
| 4.5 | CLI `codemap impact --in <path>`                     | **done** | `bun test src/cli/cmd-impact.test.ts`            |
| 4.6 | MCP/HTTP `impact` `in` param                         | **done** | MCP tests                                        |
| 4.7 | Doc lift (architecture § impact)                     | **done** | format check                                     |
| 4.s | Commit + PR + CI                                     | **done** | `bun run check`                                  |

---

## Pre-locked decisions

| #    | Decision                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------- |
| P2.1 | `inPath` semantics match `show-engine` prefix/exact rules (not `define_in` — that's write-side anchor). |
| P2.2 | Unscoped homonym → union per-file walks, not silent name-level merge.                                   |
| P2.3 | Moat A safe — still composable graph envelope, not a verdict primitive.                                 |

---

## Acceptance

- [x] Homonym: unscoped walk unions per-defining-file graphs
- [x] `inPath` outside `matched_in` → empty matches + skip reason
- [x] CLI `--in` and MCP `in` wired
- [ ] PR merged to `main`

### Verify

```bash
bun test src/application/impact-engine.test.ts src/cli/cmd-impact.test.ts
bun run check
```

---

## Lifecycle

**Close when:** PR merged. Delete this file; lift to `docs/architecture.md` § impact; update orchestrator session log.
