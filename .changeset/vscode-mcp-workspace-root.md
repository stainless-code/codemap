---
"@stainless-code/codemap": patch
---

`codemap agents init --mcp` now includes `--root ${workspaceFolder}` in the VS Code / Copilot MCP config (`.vscode/mcp.json`), same as Cursor. Re-run `codemap agents init --mcp` (or `--target copilot`) to upgrade an existing `.vscode/mcp.json` from older init output.
