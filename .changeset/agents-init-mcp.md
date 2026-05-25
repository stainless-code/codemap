---
"@stainless-code/codemap": patch
---

Add `codemap agents init --mcp` — project-level MCP config for Cursor, Claude Code, VS Code, Continue, Cline, Amazon Q (workspace `.amazonq/default.json` + legacy `.amazonq/mcp.json`), and Gemini CLI (Windsurf when that integration is selected), with idempotent JSON merge and Claude `mcp__codemap__*` permissions.
