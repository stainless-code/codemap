# VS Code MCP workspace root — handoff

> **Status:** implemented (pending release) · **Priority:** P2 · **Effort:** S (~half day) · **Trigger:** fact-check from consumer repo + internal dogfood mismatch
>
> **Motivator:** `codemap agents init --mcp` previously injected `--root ${workspaceFolder}` for Cursor only. VS Code / Copilot now gets the same explicit root (PR #156). Original trigger: consumer repo fact-check + internal dogfood mismatch.
>
> **Origin:** [merchant-dashboard-v2 PR #1569](https://github.com/PaySpaceDevs/merchant-dashboard-v2/pull/1569) — codemap 0.9.2 upgrade + MCP wiring review.

---

## Summary for the next owner

| Question                                               | Answer                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Is this a VS Code `${workspaceFolder}` resolution bug? | **No.** Init never failed to substitute — it simply did not write the variable for VS Code before this fix.                        |
| Is codemap `init --mcp` accidentally broken?           | **Was an intentional registry gap** — only Cursor had `workspaceRootArg: true`. **Fixed:** both Cursor and VS Code set the flag.   |
| Is the VS Code scaffold **correct**?                   | **Yes after fix.** Init emits `mcp --watch --root ${workspaceFolder}` on `.vscode/mcp.json`.                                       |
| Are consumer overrides wrong?                          | **No.** Overrides like `--no-watch` remain valid. Re-run `init --mcp` to pick up `--root` if `.vscode/mcp.json` predates this fix. |

**Shipped fix:** Option **A** — `workspaceRootArg: true` on the `vscode` registry entry (parity with Cursor and dogfood `.vscode/mcp.json`).

---

## Shipped behavior (post PR #156)

### Registry

`src/agents-init-mcp-registry.ts` — **`cursor`** and **`vscode`** set `workspaceRootArg: true`.

### Spawn builder

`src/codemap-invocation.ts` — `buildCodemapMcpSpawn(invocation, includeWorkspaceRoot)` appends `--root ${workspaceFolder}` when the registry flag is true.

### Init + tests

- `src/agents-init-mcp.ts` — Cursor and VS Code get `${workspaceFolder}` root injection; cwd-based clients omit `--root`.
- `src/agents-init-mcp.test.ts` — vscode-only write/merge/idempotent/upgrade tests; integration test asserts full args array.

### Docs

`docs/agents.md` § MCP wiring — VS Code row documents `mcp --watch --root ${workspaceFolder}` (same spawn tail as Cursor, different JSON shape).

### Dogfood reference

This repository's **`.vscode/mcp.json`** uses explicit `--root ${workspaceFolder}` — now aligned with consumer init output.

---

## Fact-check vs official docs

### Codemap CLI semantics

Per README § Environment / flags: **`--root`** overrides **`CODEMAP_ROOT`** / **`CODEMAP_TEST_BENCH`**, then **`process.cwd()`**. If spawn `cwd` is wrong, the index targets the wrong tree with no `--root`.

Bundled skill (`templates/agent-content/skill/10-recipes-context.md`): _"spawn `cwd` is the project root unless `--root` overrides."_

### VS Code ([MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration))

| Topic                            | Finding                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stdio spawn **cwd**              | **Not documented** as workspace root. Stdio field table lists `command`, `args`, `env`, `envFile`, sandbox — no guaranteed cwd semantics.                                                                                                                                                                                                                   |
| `${workspaceFolder}` in config   | Documented for values like `envFile` and sandbox paths.                                                                                                                                                                                                                                                                                                     |
| `${workspaceFolder}` in **args** | Intended to work (`${}` syntax per [variables reference](https://code.visualstudio.com/docs/reference/variables-reference)); real bugs reported — [vscode#245905](https://github.com/microsoft/vscode/issues/245905) (open), [vscode#251263](https://github.com/microsoft/vscode/issues/251263) (wrong `{workspaceFolder}` syntax vs `${workspaceFolder}`). |
| When cwd is wrong                | Community workaround: `"cwd": "${workspaceFolder}"` on the server entry — [vscode#251308](https://github.com/microsoft/vscode/issues/251308) (devcontainer / PATH context).                                                                                                                                                                                 |

**Conclusion:** Codemap's bet that VS Code stdio MCP **always** runs with workspace `cwd` is **not backed by official documentation** and is **contradicted by issue history** in edge environments (devcontainers, multi-root, remote).

### Cursor ([MCP docs](https://cursor.com/docs/mcp))

- Documents **`${workspaceFolder}`** interpolation in `command`, `args`, `env`, `url`, `headers`.
- Defines it as the folder containing `.cursor/mcp.json`.
- Spawn / PATH issues are common (PM-aware `bunx` / `npx` fix in 0.9.2) — explicit `--root` is still valuable even when variables work.

---

## Options (decision record — **A** chosen)

| #     | Change                                                                                 | Pros                                                                                                | Cons                                                                                                  |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A** | Set `workspaceRootArg: true` on **`vscode`** in registry                               | Parity with Cursor; matches dogfood `.vscode/mcp.json`; one code path; uses codemap-native `--root` | Relies on VS Code resolving `${workspaceFolder}` in args (same as Cursor today)                       |
| **B** | Add `"cwd": "${workspaceFolder}"` to VS Code server entry (keep args without `--root`) | Uses host cwd when variable works; codemap still reads `process.cwd()`                              | VS Code `cwd` field not in main stdio table (community pattern only); duplicate mechanism vs `--root` |
| **C** | `"env": { "CODEMAP_ROOT": "${workspaceFolder}" }`                                      | Avoids codemap-specific flag in args                                                                | Less visible in logs; env substitution still subject to VS Code variable bugs                         |
| **D** | Document only — tell consumers to hand-patch                                           | Zero code change                                                                                    | Leaves init scaffold wrong vs dogfood; repeats support burden                                         |

**Chosen:** **A** — implemented in PR #156 (`workspaceRootArg: true` + docs/tests/changeset).

Optional follow-up: document **`--no-watch`** as a consumer override when file watcher hangs on large repos (out of scope for this plan's core fix).

---

## Implementation steps (done)

1. [x] **`src/agents-init-mcp-registry.ts`** — `workspaceRootArg: true` on the `vscode` entry.
2. [x] **`src/agents-init-mcp.test.ts`** — assert VS Code args include `--root` and `${workspaceFolder}`.
3. [x] **`src/agents-init-mcp.ts`** — comment: Cursor and VS Code get explicit root injection.
4. [x] **`docs/agents.md`** — VS Code row updated.
5. [x] **`bun test src/agents-init-mcp.test.ts`** (+ registry/cli coverage).
6. [x] **Changeset** — patch note for npm release.

---

## Acceptance

- [x] `applyAgentsInitMcp({ targets: ["vscode"] })` writes `--root` + `${workspaceFolder}` in `.vscode/mcp.json`.
- [x] Idempotent merge still preserves foreign servers in `servers`.
- [x] `docs/agents.md` MCP table matches registry behavior.
- [x] No change to Claude / Continue / Cline / Amazon Q / Gemini targets (remain cwd-based unless a separate issue opens).

---

## Consumer guidance

Projects with `.vscode/mcp.json` from **older** init output (no `--root`) should re-run **`codemap agents init --mcp`** (or **`--interactive`** and select Copilot only) to upsert the codemap server entry. Init merge is idempotent and preserves foreign `servers`.

Custom overrides remain valid:

- **`--no-watch`** — still required when watch hangs on large repos.
- **Hand-patched `--root ${workspaceFolder}`** — safe to keep; init will converge to the same args on re-run.

Do **not** assume VS Code stdio spawn `cwd` equals workspace root — official docs do not guarantee it (see [Fact-check vs official docs](#fact-check-vs-official-docs) above).

---

## Related files

| Path                                   | Role                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/agents-init-mcp-registry.ts`      | Per-IDE flags                                              |
| `src/agents-init-mcp.ts`               | Init writer                                                |
| `src/codemap-invocation.ts`            | Spawn args builder                                         |
| `src/agents-init-mcp.test.ts`          | Regression tests                                           |
| `docs/agents.md`                       | Consumer-facing MCP table                                  |
| `.vscode/mcp.json`                     | Dogfood reference (already uses `--root`)                  |
| `docs/plans/cross-project-mcp-root.md` | Separate concern — multi-root tool `root` param at runtime |

---

## Revisit / out of scope

- **Multi-root MCP `root` tool argument** — see [cross-project-mcp-root.md](./cross-project-mcp-root.md).
- **Default `--no-watch` in init** — environment-specific; consumers override.
- **Fixing VS Code variable resolution bugs** — upstream vscode; codemap can only document workarounds (`cwd`, env, or absolute paths).

---

## References

- VS Code MCP config: <https://code.visualstudio.com/docs/copilot/reference/mcp-configuration>
- Cursor MCP + interpolation: <https://cursor.com/docs/mcp>
- Codemap root precedence: [README § Environment / flags](../../README.md#cli)
