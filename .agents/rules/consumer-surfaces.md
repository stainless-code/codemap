---
description: Consumer-facing surfaces must describe user-visible behavior only — no maintainer internals, CI wiring, or implementation file names.
alwaysApply: true
---

# Consumer surfaces

Consumers install **`@stainless-code/codemap`** and interact through CLI, MCP, HTTP, and bundled agent templates. They must only see **what to run** and **what it does** — never how this repo implements it.

## Consumer surfaces (write for users)

| Surface                                  | Audience                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `templates/agent-content/**`             | Served live via `codemap skill` / `codemap rule`, `codemap://skill` / `codemap://rule`, MCP `instructions`, HTTP resources |
| `templates/agents/**`                    | Copied into consumer projects by `codemap agents init`                                                                     |
| **`.changeset/*.md` body**               | Release notes → `CHANGELOG.md` on npm                                                                                      |
| **Root `README.md` (install / usage)**   | npm landing page                                                                                                           |
| **CLI help text and user-facing errors** | Terminal output                                                                                                            |

`docs/agents.md` is maintainer reference linked from bundled README — keep **MCP wiring / init** sections consumer-accurate; implementation tables belong in maintainer sections, not in served agent-content.

## Maintainer-only (never leak into consumer surfaces)

- Internal refactors, CI / GitHub Action wiring, dual-file sync (`*.ts` ↔ `*.mjs`)
- `scripts/`, `docs/plans/`, `docs/research/`, module paths under `src/`
- Dogfood paths (`bun src/index.ts`) — maintainer workflow only; consumers use PM-aware spawn from `agents init --mcp`
- “We moved X to Y” unless the **user-visible** command or output changed

## When editing consumer surfaces

1. **Behavior, not implementation** — e.g. “PM-aware MCP spawn via `agents init --mcp`”, not “`resolveCodemapCliInvocation` in `codemap-invocation.ts`”.
2. **Changesets** — user-visible outcome only; no Action refactors, detect-pm delegation, or sync comments between source files.
3. **Served skill / rule** — no hardcoded `{command: "codemap"}` unless documenting legacy manual wiring; prefer `codemap agents init --mcp` and PM-specific examples (`npx`, `pnpm exec`, `yarn exec`, `bunx`, dlx).
4. **Cross-ref maintainer detail** — plans, architecture internals, and contributor tables stay in `docs/` or `.agents/` skills; link from consumer text only when the user must follow a public doc (e.g. [agents.md § MCP wiring](https://github.com/stainless-code/codemap/blob/main/docs/agents.md#mcp-wiring-via-agents-init)).

## Decision test

Before shipping text on a consumer surface: **“Would a user who only `npm i @stainless-code/codemap` care?”** If no → cut it or move it to a maintainer doc.

Related: [`write-a-skill`](../skills/write-a-skill/SKILL.md) (maintainer vs shipped templates), [`docs-governance`](./docs-governance.md) Rule 10 (agent-content layers).
