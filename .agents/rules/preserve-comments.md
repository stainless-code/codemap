---
description: Never remove comments, TODOs, or commented-out code without explicit confirmation
globs: "**/*.{ts,tsx,css,html}"
alwaysApply: true
---

# Preserve Comments, TODOs, and Commented Code

## Rules

1. **Never remove comments** — All existing comments must be preserved when editing code. If a comment becomes outdated due to your changes, update it rather than deleting it.

2. **Never remove TODO / FIXME / HACK comments** — These are intentional markers left by developers. If a TODO is completed by your changes, ask the user before removing it.

3. **Never remove commented-out code** — Commented-out code exists for a reason (debugging, future use, reference). Do not silently delete it.

4. **Ask before removing** — If you believe a TODO, comment, or commented-out code block should be removed, explicitly ask the user for confirmation before doing so.

## When editing code

- Copy over all comments that exist in the original code block you are replacing.
- If restructuring code, move comments to their new logical location rather than dropping them.
- When using StrReplace, ensure the `old_string` and `new_string` both account for any comments in the affected region.
