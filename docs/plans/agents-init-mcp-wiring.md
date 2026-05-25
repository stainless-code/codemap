# Agents init MCP wiring — plan

> **Status:** open (in review) · **PR:** [#135](https://github.com/stainless-code/codemap/pull/135) · **Priority:** P1 · **Effort:** M (~1–2 weeks)
>
> **Motivator:** `codemap agents init` wires rules/skills into 9 IDE targets but leaves MCP config manual. Agents won't use the index if MCP isn't configured and permission-gated (Claude Code blocks tools by default).
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1) · extends [agents.md](../agents.md)

---

## Pre-locked decisions

| #   | Decision                                                                                                       | Source                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| L.1 | **Keep pointer protocol** for skill/rule bodies — MCP wiring writes config JSON only, not duplicated markdown. | [agents.md](../agents.md)       |
| L.2 | New flag **`--mcp`** on `agents init` (interactive step + non-interactive opt-in).                             | Opt-in                          |
| L.3 | MCP command shape: `codemap mcp --watch` with transport-specific args (Cursor: `--root ${workspaceFolder}`).   | Work around MCP cwd ≠ workspace |
| L.4 | Claude Code: append **`permissions.allow`** entries for `mcp__codemap__*` tools when `--mcp` set.              | Reduce prompt friction          |

---

## Shipped (PR #135)

| Target            | Config path                                                             | Notes                                                                                            |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cursor            | project **`.cursor/mcp.json`**                                          | `--root ${workspaceFolder}`                                                                      |
| Claude Code       | project **`.mcp.json`** + **`.claude/settings.json`**                   | cwd-based MCP; `permissions.allow`                                                               |
| VS Code / Copilot | project **`.vscode/mcp.json`** (`servers` key)                          | [VS Code MCP reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)  |
| Continue          | project **`.continue/mcpServers/codemap-mcp.json`**                     | JSON `mcpServers` block file                                                                     |
| Amazon Q          | project **`.amazonq/mcp.json`** (legacy workspace MCP)                  | [AWS MCP IDE docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html)        |
| Gemini CLI        | project **`.gemini/settings.json`** (`mcpServers`)                      | [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/HEAD/docs/tools/mcp-server.md) |
| Cline             | project **`.cline/mcp.json`**                                           | [Cline CLI reference](https://docs.cline.bot/cli/cli-reference)                                  |
| Windsurf          | user **`~/.codeium/windsurf/mcp_config.json`** when `windsurf` selected | User-global only per [Windsurf docs](https://docs.windsurf.com/windsurf/cascade/mcp)             |

Default **`--mcp`** (no `--target` filter) writes all **project-local** rows. **Windsurf** runs only when that integration is explicitly selected.

Side-effect-only re-runs: **`--mcp`**, **`--git-hooks`**, **`--no-git-hooks --mcp`** work when `.agents/` already exists without **`--force`**.

---

## Deferred (v2+)

| Item                                                  | Notes                                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Global `~/.cursor/mcp.json` / `~/.claude.json`        | Project config preferred for team check-in           |
| Marker-based uninstall (`<!-- CODEMAP_MCP_START -->`) | No `--no-mcp` strip path yet                         |
| Amazon Q `.amazonq/default.json` GUI format           | Legacy `.amazonq/mcp.json` wired for workspace scope |

---

## Acceptance

- [x] `codemap agents init --mcp` (and `-i` confirm) writes MCP config for all supported integrations ([#135](https://github.com/stainless-code/codemap/pull/135))
- [x] Re-run is idempotent (merge preserves foreign servers)
- [x] Pointer skill/rule unchanged in content shape (JSON only)

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
- [mcp-tool-allowlist](./mcp-tool-allowlist.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
