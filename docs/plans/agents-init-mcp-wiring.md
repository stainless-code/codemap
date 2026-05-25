# Agents init MCP wiring — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~1–2 weeks)
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

## Target matrix (v1)

| Target                | Config path                                        | Notes                              |
| --------------------- | -------------------------------------------------- | ---------------------------------- |
| Cursor                | `~/.cursor/mcp.json` or project `.cursor/mcp.json` | Inject `--root ${workspaceFolder}` |
| Claude Code           | `~/.claude.json` MCP + settings permissions        | Auto-allow codemap tools           |
| VS Code / Copilot     | `.vscode/mcp.json` if supported                    | Detect capability                  |
| Continue / Cline      | existing init paths                                | Same stdio command                 |
| AGENTS.md / GEMINI.md | Usage section only (no MCP file)                   | Document manual MCP                |

Reuse patterns from `src/agents-init-interactive.ts`; add `src/agents-init-mcp.ts`.

---

## Implementation steps

1. **Detect + write MCP entries** per target (read-merge, don't clobber unrelated servers)
2. **Marker blocks** for idempotent uninstall (`<!-- CODEMAP_MCP_START -->`)
3. **`--mcp` flag** on `agents init` and interactive prompt
4. **Cursor workaround** — document in generated rule pointer: "always pass workspace root"
5. **Tests** — fixture configs; merge preserves foreign entries
6. **Docs** — agents.md § MCP wiring; README quickstart

---

## Acceptance

- [ ] `codemap agents init --mcp -i` writes working MCP config for Cursor + Claude
- [ ] Re-run is idempotent
- [ ] Pointer skill/rule unchanged in content shape

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) improves first-run agent behavior
- [mcp-tool-allowlist](./mcp-tool-allowlist.md) optional for minimal installs
