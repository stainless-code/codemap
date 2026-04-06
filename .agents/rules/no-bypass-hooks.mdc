---
description: Never bypass or skip pre-commit hooks when committing code
alwaysApply: true
---

# Never Bypass Pre-Commit Hooks

## Rules

1. **Never use `--no-verify`** — Do not pass `--no-verify` (or `-n`) to `git commit`. The pre-commit hooks exist to enforce code quality (formatting, linting, type-checking, tests) and must always run.

2. **Never use `--no-gpg-sign`** or other hook-skipping flags unless the user explicitly requests it.

3. **If hooks fail, fix the code** — When a pre-commit hook rejects a commit, fix the underlying issue (type errors, lint violations, formatting) and commit again. Do not work around the hook.

4. **No exceptions without explicit user consent** — If you believe a hook must be skipped for a legitimate reason, explain why and ask the user for explicit permission before proceeding.
