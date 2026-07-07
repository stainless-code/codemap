---
description: Build features in small end-to-end slices, not big horizontal layers
alwaysApply: true
---

# Tracer bullets

Build a tiny end-to-end slice first, validate, then expand. AI agents tend to produce complete solutions in one leap without testing the critical path — massive review burden and rework ("slop").

## Rules

1. **One vertical slice** — touches all relevant layers for the simplest case (CLI + parser + db + test, etc.).
2. **Commit and validate** before expanding — pre-commit runs format, lint, typecheck, tests on staged files (when AI/agent env vars trigger it).
3. **Lite-harden the slice** — [`harden-pr`](../skills/harden-pr/SKILL.md) **lite** mode after each slice (fix in working tree; commit when the user asks).
4. **Expand outward** from the working slice.
5. **Never build horizontal layers in isolation** (all DB helpers before any CLI wiring, all docs before any working index path, etc.).

Feature layers and worked examples: [`tracer-bullets` skill](../skills/tracer-bullets/SKILL.md).

Before opening a PR: [`harden-pr`](../skills/harden-pr/SKILL.md) **full** on `origin/main...HEAD`.
