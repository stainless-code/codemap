# VS Code MCP workspace root — handoff

> **Status:** implemented (pending release) · **Priority:** P2 · **Effort:** S (~half day) · **Trigger:** fact-check from consumer repo + internal dogfood mismatch
>
> **Motivator:** `codemap agents init --mcp` injects `--root ${workspaceFolder}` for Cursor only. VS Code / Copilot gets `mcp --watch` with no explicit project root. That contradicts codemap's own `.vscode/mcp.json` and leaves index resolution to spawn `cwd` — a guarantee VS Code does not document.
>
> **Origin:** [merchant-dashboard-v2 PR #1569](https://github.com/PaySpaceDevs/merchant-dashboard-v2/pull/1569) — codemap 0.9.2 upgrade + MCP wiring review.

---

## Summary for the next owner

| Question                                               | Answer                                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is this a VS Code `${workspaceFolder}` resolution bug? | **No.** Init never writes the variable for VS Code; it is not failing to substitute.                                                                                         |
| Is codemap `init --mcp` accidentally broken?           | **No.** Intentional registry flag — only Cursor has `workspaceRootArg: true`.                                                                                                |
| Is the VS Code scaffold **correct**?                   | **Weak / over-optimistic.** Official docs do not guarantee stdio spawn `cwd` = workspace root; codemap dogfoods `--root` on VS Code anyway.                                  |
| Are consumer overrides wrong?                          | **No.** Keeping `--root ${workspaceFolder}` (and `--no-watch` where needed) on **both** `.cursor/mcp.json` and `.vscode/mcp.json` is the safer choice until upstream aligns. |

**Recommended fix:** add explicit workspace-root wiring for the `vscode` MCP target (prefer **`workspaceRootArg: true`** for parity with Cursor and with this repo's dogfood config).

---

## Current behavior (source of truth)

### Registry

`src/agents-init-mcp-registry.ts` — only **`cursor`** sets `workspaceRootArg: true`. **`vscode`** omits it (defaults false).

### Spawn builder

`src/codemap-invocation.ts` — `buildCodemapMcpSpawn(invocation, includeWorkspaceRoot)` appends `--root ${workspaceFolder}` only when the second arg is `true`.

### Init comment + tests

- `src/agents-init-mcp.ts` — _"Cursor uses `${workspaceFolder}` root injection; most other clients rely on workspace cwd."_
- `src/agents-init-mcp.test.ts` — `"includes workspace root for Cursor"` vs `"omits --root for cwd-based clients"`.

### Docs table gap

`docs/agents.md` § MCP wiring — Cursor row documents `--root ${workspaceFolder}`; VS Code row only mentions `type: stdio` (does not state that `--root` is omitted by design).

### Internal inconsistency (dogfood)

This repository's **`.vscode/mcp.json`** already uses:

```json
"args": ["src/index.ts", "mcp", "--watch", "--root", "${workspaceFolder}"]
```

So maintainers expect explicit `--root` on VS Code while `init --mcp` does not emit it for consumers.

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

## Options (ranked)

| #     | Change                                                                                 | Pros                                                                                                | Cons                                                                                                  |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A** | Set `workspaceRootArg: true` on **`vscode`** in registry                               | Parity with Cursor; matches dogfood `.vscode/mcp.json`; one code path; uses codemap-native `--root` | Relies on VS Code resolving `${workspaceFolder}` in args (same as Cursor today)                       |
| **B** | Add `"cwd": "${workspaceFolder}"` to VS Code server entry (keep args without `--root`) | Uses host cwd when variable works; codemap still reads `process.cwd()`                              | VS Code `cwd` field not in main stdio table (community pattern only); duplicate mechanism vs `--root` |
| **C** | `"env": { "CODEMAP_ROOT": "${workspaceFolder}" }`                                      | Avoids codemap-specific flag in args                                                                | Less visible in logs; env substitution still subject to VS Code variable bugs                         |
| **D** | Document only — tell consumers to hand-patch                                           | Zero code change                                                                                    | Leaves init scaffold wrong vs dogfood; repeats support burden                                         |

**Recommendation:** **A** (registry one-liner) + update **`docs/agents.md`** VS Code row + extend **`applyAgentsInitMcp`** integration test to assert VS Code args include `--root` and `${workspaceFolder}`.

Optional follow-up: document **`--no-watch`** as a consumer override when file watcher hangs on large repos (out of scope for this plan's core fix).

---

## Implementation steps

1. **`src/agents-init-mcp-registry.ts`** — add `workspaceRootArg: true` to the `vscode` entry (or rename flag to `injectWorkspaceRootArg` if the Cursor-only comment is retired).
2. **`src/agents-init-mcp.test.ts`** — in `"writes all default project MCP files"`, assert `vscode.servers.codemap.args` contains `"--root"` and `"${workspaceFolder}"` (mirror Cursor assertions).
3. **`src/agents-init-mcp.ts`** — update the file comment: both Cursor and VS Code get explicit root injection; other cwd-based clients remain unchanged.
4. **`docs/agents.md`** — VS Code row: `servers.codemap` with `type: stdio` **and** `mcp --watch --root ${workspaceFolder}` (same spawn tail as Cursor, different JSON shape).
5. **Re-run** `bun test src/agents-init-mcp.test.ts` (and full `check` if touching registry exports).
6. **CHANGELOG** — patch note under `agents init --mcp` (VS Code workspace root parity).

---

## Acceptance

- [x] `applyAgentsInitMcp({ targets: ["vscode"] })` writes `--root` + `${workspaceFolder}` in `.vscode/mcp.json`.
- [x] Idempotent merge still preserves foreign servers in `servers`.
- [x] `docs/agents.md` MCP table matches registry behavior.
- [x] No change to Claude / Continue / Cline / Amazon Q / Gemini targets (remain cwd-based unless a separate issue opens).

---

## Consumer guidance (until shipped)

Projects that already override MCP config (example: large-repo `--no-watch`, explicit `--root` on both IDEs) should **keep overrides**. Re-running `init --mcp` without re-applying:

- **`--no-watch`** — still required when watch hangs.
- **`--root ${workspaceFolder}`** on VS Code — still recommended until this plan ships.

Do **not** assume `init --mcp` output is authoritative for VS Code root pinning today.

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
