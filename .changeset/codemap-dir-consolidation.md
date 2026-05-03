---
"@stainless-code/codemap": minor
---

`.codemap/` directory consolidation + self-healing files. Every codemap-managed path lives under a single configurable state directory (default `.codemap/`, override via `--state-dir <path>` or `CODEMAP_STATE_DIR`). Cleans up the dual-pattern surface (`<root>/.codemap.db` + `<root>/.codemap/<thing>/`) that's been growing with every cache PR; collapses the user `.gitignore` patching surface to zero.

**New layout:**

```
<root>/
└── .codemap/                 ← override via --state-dir / CODEMAP_STATE_DIR
    ├── .gitignore            ← codemap-managed (self-healing); tracked
    ├── config.{ts,js,json}   ← was <root>/codemap.config.*; tracked
    ├── recipes/              ← user-authored SQL; tracked (existing)
    ├── index.db              ← was .codemap.db
    ├── index.db-shm          ← was .codemap.db-shm
    ├── index.db-wal          ← was .codemap.db-wal
    └── audit-cache/          ← was .codemap/audit-cache/ (existing)
```

**Self-healing files (D11):** `<state-dir>/.gitignore` and `<state-dir>/config.json` are owned by idempotent `ensure*` reconcilers (`src/application/state-dir.ts`, `src/application/state-config.ts`) that run on every codemap boot — read → validate → reconcile → write only on drift. **The setup logic IS the migration**: future codemap versions add new generated artifacts to `STATE_GITIGNORE_BODY` (or extend the Zod schema), and every consumer's project repairs itself on the next `codemap` invocation. No more per-feature `.gitignore` patching in `agents-init.ts`.

**Pre-v1 — no migration shim:**

- `<root>/.codemap.db` → `<state-dir>/index.db` (rename basename)
- `<root>/codemap.config.{ts,json}` → `<state-dir>/config.{ts,js,json}` (move file)
- Existing dev clones: `rm .codemap.db .codemap.db-shm .codemap.db-wal` once and re-index; move `codemap.config.*` into `.codemap/` (or set `--config <old-path>` to keep using the legacy location explicitly).

**New flags + env:**

- `--state-dir <path>` — override the state directory (resolves relative to project root).
- `CODEMAP_STATE_DIR` — same, env-var form.

**Internal refactor:** new `src/cli/bootstrap-codemap.ts` extracts the `loadUserConfig + resolveCodemapConfig + initCodemap + configureResolver` dance from 9 cmd-\* files into one helper that also runs the self-healing reconcilers. Adding a new self-healing file is now a one-line addition there.

Inspired by flowbite-react's `.flowbite-react/.gitignore` + `setup-*` pattern; expressed in codemap's own conventions (`ensure*` reconcilers, Zod schema as `z.infer` source of truth, pure `{before, after, written}` return shapes for testability).

Plan: PR #53 (merged). Implementation: PR #54.
