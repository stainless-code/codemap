---
"@stainless-code/codemap": patch
---

docs(cli): `mcp --help` and `serve --help` now list every shipped tool + resource

Stale help text in `src/cli/cmd-mcp.ts` and `src/cli/cmd-serve.ts` listed the original v1 tool / resource taxonomy. Updated to match what's registered today (verified against `src/application/mcp-server.ts`):

- **`mcp --help` Tools section** now includes `show`, `snippet`, `impact` (was missing all three).
- **`mcp --help` Resources section** now distinguishes lazy-cached catalog resources (`recipes`, `recipes/{id}`, `schema`, `skill`) from live read-per-call resources (`files/{path}`, `symbols/{name}`) — was listing only the original four.
- **`serve --help` Routes section** now includes `POST /tool/impact` (was missing) and lists every mirrored MCP resource explicitly under `GET /resources/{encoded-uri}` (was a `...` ellipsis).

No behavior change — purely a documentation accuracy fix. Bundled agent rule + skill (`templates/agents/` and `.agents/`) already enumerate the six resources correctly.
