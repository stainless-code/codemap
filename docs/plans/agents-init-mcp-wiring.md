# Agents init MCP wiring — plan

> **Status:** shipped (v1) · **Priority:** P1 · **Effort:** M (~1–2 weeks)
>
> **Motivator:** `codemap agents init` wires rules/skills into 9 IDE targets but leaves MCP config manual. Agents won't use the index if MCP isn't configured and permission-gated (Claude Code blocks tools by default).
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1) · extends [agents.md](../agents.md)
>
> **Shipped:** [#135](https://github.com/stainless-code/codemap/pull/135) — project-level Cursor + Claude Code

---

## Pre-locked decisions

| #   | Decision                                                                                                       | Source                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| L.1 | **Keep pointer protocol** for skill/rule bodies — MCP wiring writes config JSON only, not duplicated markdown. | [agents.md](../agents.md)       |
| L.2 | New flag **`--mcp`** on `agents init` (interactive step + non-interactive opt-in).                             | Opt-in                          |
| L.3 | MCP command shape: `codemap mcp --watch` with transport-specific args (Cursor: `--root ${workspaceFolder}`).   | Work around MCP cwd ≠ workspace |
| L.4 | Claude Code: append **`permissions.allow`** entries for `mcp__codemap__*` tools when `--mcp` set.              | Reduce prompt friction          |

---

## v1 shipped (PR #135)

| Target      | Config path                                                                 | Notes                              |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Cursor      | project **`.cursor/mcp.json`**                                              | `--root ${workspaceFolder}`        |
| Claude Code | project **`.mcp.json`** + **`.claude/settings.json`** (`permissions.allow`) | cwd-based MCP; no `--root` in args |

Side-effect-only re-runs: **`--mcp`**, **`--git-hooks`**, **`--no-git-hooks --mcp`** work when `.agents/` already exists without **`--force`**.

---

## Deferred (v2+)

| Item                                                  | Notes                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Global `~/.cursor/mcp.json` / `~/.claude.json`        | Project config only in v1                                                    |
| VS Code `.vscode/mcp.json`                            | Detect capability first                                                      |
| Continue / Cline MCP paths                            | Rules wiring exists; MCP JSON not wired                                      |
| Marker-based uninstall (`<!-- CODEMAP_MCP_START -->`) | No `--no-mcp` strip path yet                                                 |
| Rule pointer “always pass workspace root” blurb       | Covered in [agents.md § MCP wiring](../agents.md#mcp-wiring-via-agents-init) |

---

## Acceptance (v1)

- [x] `codemap agents init --mcp` (and `-i` confirm) writes Cursor + Claude project MCP config ([#135](https://github.com/stainless-code/codemap/pull/135))
- [x] Re-run is idempotent (merge preserves foreign servers)
- [x] Pointer skill/rule unchanged in content shape (JSON only)

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
- [mcp-tool-allowlist](./mcp-tool-allowlist.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
