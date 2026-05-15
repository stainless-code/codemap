---
actions:
  - type: review-env-var
    description: "Every distinct `process.env.X` access, ranked by use count. Cross-check against your env schema / .env.example to find env vars used but not declared (or declared but unused)."
---

# env-var-audit

Every distinct `process.env.X` access in the codebase, with use count and file fan-out.

```bash
codemap query --recipe env-var-audit
```

Useful workflows:

- **Find shipped env vars** — every row is a deploy-time configuration knob.
- **Find single-use env vars** — `WHERE uses = 1` candidates for inlining.
- **Cross-reference your `.env.example`** — env vars in the audit but not in `.env.example` are undocumented.

Only direct `process.env.X` patterns are detected; `Bun.env`, `Deno.env.get('X')`, `import.meta.env.X` (Vite) are not yet covered.
