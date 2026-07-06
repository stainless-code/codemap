---
description: STOP and run architecture skills before structurally significant changes (module moves, schema/boundary, new exports, agent template layering)
alwaysApply: true
---

# Architecture priming

Most code changes are line-level — a parser fix, a CLI flag, a query recipe. They don't need architectural review. **A small minority of changes are structurally significant** and pay back compound interest if reviewed before they land. This rule fires the architecture skills on those signals only, not on every edit.

## STOP if any of these apply

- **≥5 files moved** between top-level `src/` modules (e.g. `src/cli/` → sibling folder)
- **New `src/<X>/` module** — a new top-level source subtree
- **Schema or boundary change** in `src/db.ts` (`SCHEMA_VERSION`, new tables/columns with cross-module impact)
- **New subpath export** in `package.json` `exports`
- **`templates/agent-content` vs `templates/agents` layering breach** — consumer-served content mixed with init-copied templates (see [`consumer-surfaces`](./consumer-surfaces.md))

For each signal: STOP and run [`improve-codebase-architecture`](../skills/improve-codebase-architecture/SKILL.md) before proceeding; on open PRs or post-merge, also [`audit-pr-architecture`](../skills/audit-pr-architecture/SKILL.md).

## Otherwise, proceed normally

Line-level changes **do not trigger this rule**. Use intent-triggered skills (`harden-pr`, `diagnose`, etc.).

## Reference

[`improve-codebase-architecture`](../skills/improve-codebase-architecture/SKILL.md) · [`audit-pr-architecture`](../skills/audit-pr-architecture/SKILL.md) · [`tracer-bullets`](./tracer-bullets.md) · [`docs/architecture.md`](../../docs/architecture.md)
