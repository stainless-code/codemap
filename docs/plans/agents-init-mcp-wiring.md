# Agents init MCP wiring — plan

> **Status:** shipped · **PR:** [#135](https://github.com/stainless-code/codemap/pull/135) (merged) · **Priority:** P1 · **Effort:** M (~1–2 weeks)
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

| Target            | Config path                                                             | Notes                                                                                                 |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cursor            | project **`.cursor/mcp.json`**                                          | `--root ${workspaceFolder}`                                                                           |
| Claude Code       | project **`.mcp.json`** + **`.claude/settings.json`**                   | cwd-based MCP; `permissions.allow`                                                                    |
| VS Code / Copilot | project **`.vscode/mcp.json`** (`servers` key)                          | [VS Code MCP reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)       |
| Continue          | project **`.continue/mcpServers/codemap-mcp.json`**                     | JSON `mcpServers` block file                                                                          |
| Amazon Q          | project **`.amazonq/default.json`** + **`.amazonq/mcp.json`**           | [AWS MCP IDE docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html) — see below |
| Gemini CLI        | project **`.gemini/settings.json`** (`mcpServers`)                      | [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/HEAD/docs/tools/mcp-server.md)      |
| Cline             | project **`.cline/mcp.json`**                                           | [Cline CLI reference](https://docs.cline.bot/cli/cli-reference)                                       |
| Windsurf          | user **`~/.codeium/windsurf/mcp_config.json`** when `windsurf` selected | User-global only per [Windsurf docs](https://docs.windsurf.com/windsurf/cascade/mcp)                  |

Default **`--mcp`** (no `--target` filter) writes all **project-local** rows. **Windsurf** runs only when that integration is explicitly selected.

Side-effect-only re-runs: **`--mcp`**, **`--git-hooks`**, **`--no-git-hooks --mcp`** work when `.agents/` already exists without **`--force`**.

### Amazon Q (IDE + legacy)

Per [AWS MCP configuration for Q Developer in the IDE](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html):

| Scope     | Canonical (GUI)               | Legacy (still supported, default-on) |
| --------- | ----------------------------- | ------------------------------------ |
| Workspace | **`.amazonq/default.json`**   | **`.amazonq/mcp.json`**              |
| Global    | `~/.aws/amazonq/default.json` | `~/.aws/amazonq/mcp.json`            |

**Codemap writes both workspace files** when Amazon Q is in scope:

- **`.amazonq/default.json`** — canonical IDE store; codemap entry includes `transportType: "stdio"`, `timeout: 60`, `disabled: false` per Q IDE examples.
- **`.amazonq/mcp.json`** — legacy path; plain `{ command, args }` in `mcpServers`. Still read when global `useLegacyMcpJson` is true (AWS default).

Workspace config takes precedence over global. Global paths are **not** written by `agents init --mcp` (team check-in / project-local scope).

---

## Deferred (v2+)

| Item                                                  | Notes                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Global `~/.cursor/mcp.json` / `~/.claude.json`        | Project config preferred for team check-in                          |
| Global `~/.aws/amazonq/default.json` / `mcp.json`     | Amazon Q global MCP — same rationale as other global-only deferrals |
| Marker-based uninstall (`<!-- CODEMAP_MCP_START -->`) | No `--no-mcp` strip path yet                                        |

---

## Acceptance

- [x] `codemap agents init --mcp` writes all default project-local MCP targets ([#135](https://github.com/stainless-code/codemap/pull/135))
- [x] Amazon Q writes **both** workspace `.amazonq/default.json` and `.amazonq/mcp.json`
- [x] Interactive `-i` writes MCP only for selected integrations (empty selection skips MCP)
- [x] Re-run is idempotent (merge preserves foreign servers)
- [x] Pointer skill/rule unchanged in content shape (JSON only)

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
- [mcp-tool-allowlist](./mcp-tool-allowlist.md) — landed [#126](https://github.com/stainless-code/codemap/pull/126)
