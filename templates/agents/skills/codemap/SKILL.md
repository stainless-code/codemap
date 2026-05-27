---
name: codemap
description: Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding where symbols are defined, tracing who imports what, listing components / hooks / CSS variables / deprecated symbols, walking dependency or call graphs, or auditing structural changes on a PR.
---

<!-- codemap-init:managed -->

# Codemap skill

Full content is served live by the installed `codemap` CLI, so version bumps carry today's reference automatically — no `agents init` re-run needed.

- **CLI:** `codemap skill` → full markdown
- **MCP:** read resource `codemap://skill`
- **HTTP:** `GET /resources/{encoded-uri}` against `codemap serve`

If `codemap` prints a pointer-protocol warning on startup, re-run `codemap agents init --force` to refresh this template.

<!-- codemap-pointer-version: 1 -->
