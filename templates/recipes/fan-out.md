---
actions:
  - type: review-coupling
    description: "High fan-out usually means orchestrator role; consider extracting helpers or splitting responsibilities."
---

Top 10 files by dependency fan-out (edge count)

Files at the top of this list act as orchestrators — they import from many other files. High fan-out usually means coordination logic that's a candidate for refactoring (extracting helpers, splitting responsibilities). Pair with `fan-in` to see hubs that are both depended-on AND depend-on-many.
