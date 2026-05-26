# Bundled agent templates

`codemap agents init` copies these files into `<your-project>/.agents/`. Use **`codemap agents init --mcp`** (or the interactive prompt) to write IDE MCP config — see [agents.md § MCP wiring](https://github.com/stainless-code/codemap/blob/main/docs/agents.md#mcp-wiring-via-agents-init). Since v1, both `rules/codemap.md` and `skills/codemap/SKILL.md` are **thin pointers**. The full content is served live by `codemap rule` / `codemap skill` (CLI), `codemap://rule` / `codemap://skill` (MCP), and `GET /resources/{encoded-uri}` against `codemap serve` (HTTP) — all three resolve to the same source under `templates/agent-content/`.

Package upgrades carry today's content automatically; you don't normally edit the pointer files. To add your own project-specific rules / skills, drop **sibling** files (e.g. `.agents/rules/my-team-conventions.md`, `.agents/skills/my-domain/SKILL.md`) — the codemap pointers stay package-managed.

**Full docs:** [`docs/agents.md` on GitHub](https://github.com/stainless-code/codemap/blob/main/docs/agents.md) — pointer protocol, section assembler, IDE wiring (Cursor, Copilot, …), staleness detection.
