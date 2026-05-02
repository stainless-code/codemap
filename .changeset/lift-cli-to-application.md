---
"@stainless-code/codemap": patch
---

Internal refactor — lift `cli/*` envelope builders + path helpers into `application/*` engines so `application/mcp-server.ts` no longer reaches sideways into `cli/`. Affected modules: `audit-engine` (added `resolveAuditBaselines`), new `context-engine` (`buildContextEnvelope`, `classifyIntent`, `ContextEnvelope`), new `validate-engine` (`computeValidateRows`, `toProjectRelative`), `show-engine` (added `buildShowResult`, `buildSnippetResult`, `ShowResult`, `SnippetResult`, `SnippetMatch`), `query-recipes` moved from `cli/` to `application/`. CLI verbs stay shells (parse / help / run / render). No behavior change, no public API change — `cli/cmd-*` and `application/*` are internal modules; the published surface (`api.ts`, the `codemap` binary, the MCP server) is untouched.
