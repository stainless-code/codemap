# MCP invocation resolve — plan

> **Status:** shipped (slice 1) · **Priority:** P1 · **Effort:** S–M
>
> **Motivator:** `agents init --mcp` used to write `"command": "codemap"`, which fails when codemap is a project devDependency (MCP hosts don't put `node_modules/.bin` on PATH). Init now shares the same PM-aware resolver as the GitHub Action (`detect-pm.mjs` / `codemap-invocation`).
>
> **Roadmap:** complements [agents init uninstall](../roadmap.md) (teardown must remove whatever spawn shape init wrote)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L.1 | **Option A — PM-aware auto:** local dep → `execute-local`; else → dlx `@stainless-code/codemap@latest`. Same Q3 ladder as [github-marketplace-action](./github-marketplace-action.md).                                   |
| L.2 | **Bun normalization:** `package-manager-detector` returns `bun` + `x`; MCP JSON uses **`bunx`** as the executable (matches docs/README).                                                                                 |
| L.3 | **Walk-up `package.json`:** treat codemap as installed when `@stainless-code/codemap` or `codemap` appears in deps/devDeps/optionalDeps in any ancestor dir.                                                             |
| L.4 | **MCP args unchanged:** only `command` + leading spawn args change; tail stays `mcp --watch [--root ${workspaceFolder}]`.                                                                                                |
| L.5 | **Shared module:** `src/codemap-invocation.ts` is source of truth; `scripts/detect-pm.mjs` imports the same helpers via `scripts/codemap-invocation.mjs`.                                                                |
| L.6 | **No argv / source-tree detection:** `agents init --mcp` targets **consumers** only (installed package or dlx). This repo's maintainer dogfood (`bun src/index.ts` in `.cursor/mcp.json`) stays manual — not init's job. |

---

## Slices

### Slice 1 — resolver + init wiring (shipped)

1. **`scripts/codemap-invocation.mjs`** — `codemapInProjectDependencies`, `normalizeSpawnCommand`, `resolveCodemapCliInvocation`, `buildCodemapMcpSpawn`
2. **`src/codemap-invocation.ts`** — typed mirror for application code
3. **`src/agents-init-mcp.ts`** — `applyAgentsInitMcp` awaits resolver once per run; log `installMethod`
4. **`scripts/detect-pm.mjs`** — delegate to shared mjs; bunx in exec output
5. **Tests** — `src/codemap-invocation.test.ts` (fixtures: scoped devDep, no dep, bun lock); update `agents-init-mcp.test.ts`, `cli.test.ts`, `detect-pm.test.mjs`
6. **Docs** — `docs/agents.md` MCP wiring; served skill `10-recipes-context.md` launch section

### Slice 2 (follow-up, optional)

- `--mcp-invocation global|auto` flag for explicit global-`codemap` override

---

## Acceptance

- [x] Empty project (no dep) → dlx spawn (e.g. `npx @stainless-code/codemap@latest mcp …`)
- [x] Project with `@stainless-code/codemap` in devDependencies → PM `execute-local` (e.g. `pnpm exec codemap mcp …`, `yarn exec codemap mcp …`)
- [x] Bun projects → `bunx codemap mcp …`, not `bun x codemap …`
- [x] `detect-pm` exec string uses same normalization
- [x] Served skill launch examples PM-aware (not bare `codemap` on PATH)
- [x] All existing init/MCP merge tests green
