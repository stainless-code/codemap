---
actions:
  - type: review-stability
    description: "High fan-in: changes here ripple through many consumers. Protect with tests before refactoring."
---

Top 15 files by fan-in (how many other files depend on them)

Files at the top are the most depended-on in the codebase (the `dependencies` table aggregates static imports, dynamic imports, and resolved module-graph edges) — changes here ripple through many consumers. Protect with tests before refactoring; treat as the project's de-facto stable API even if not formally exported.
