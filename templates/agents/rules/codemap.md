---
alwaysApply: true
---

<!-- codemap-init:managed -->

# Codemap

This project is indexed by **Codemap** — a local SQLite index of structure (symbols, imports, exports, components, dependencies, markers, scopes, references, bindings, call graphs, CSS variables, coverage).

**Before** answering structural questions (where is X defined, who imports Y, what does Z export, list components / hooks / deprecated symbols, trace dependency or call graphs), query the index — don't grep:

```bash
codemap query --json "<SQL>"     # or `codemap query --recipe <id>` for prebuilt patterns
```

Full rule (today's version, served by the installed binary):

- **CLI:** `codemap rule`
- **MCP:** read resource `codemap://rule`
- **HTTP:** `GET /resources/{encoded-uri}` against `codemap serve`

If `codemap` prints a pointer-protocol warning on startup, re-run `codemap agents init --force` to refresh this template.

<!-- codemap-pointer-version: 1 -->
