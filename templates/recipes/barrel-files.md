---
actions:
  - type: split-barrel
    description: "Confirm this is an intentional public-API surface; if it's accidental fan-out, consider splitting into smaller barrels."
---

Top 20 files by export count (barrel / public-API candidates)

High export count can indicate either an intentional public API surface or accidental fan-out. Agents can use this to decide whether a new export should land here or stay local. If it's accidental fan-out, consider splitting into smaller barrels.
