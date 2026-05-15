---
"@stainless-code/codemap": patch
---

Slim the auto-generated `<state-dir>/.gitignore` header for consumer clarity:

- Drop the internal function-name reference (`ensureStateGitignore`) — consumers can't look it up.
- Drop the "Rule 9 analogue" / "bump alongside any new cache" line — it was guidance for codemap contributors, leaking into every consumer's checkout.
- Reframe "blacklist" / parenthetical mention of tracked files in plainer language.

Existing two-line header (`# codemap-managed — edits will be overwritten by ensureStateGitignore.` / `# Blacklist of generated artifacts...`) becomes:

```
# Managed by codemap — overwritten on next run.
# Generated artifacts only; user-authored config (config.*, recipes/) stays tracked.
```

**One-time rewrite on consumer side.** The reconciler matches the canonical body via exact string comparison, so every consumer's next `codemap` run rewrites `<state-dir>/.gitignore` to the new shape (no entries change — only the comment lines). Harmless; the blacklist entries (`index.db`, `index.db-shm`, `index.db-wal`, `audit-cache/`) are unchanged.
