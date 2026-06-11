# Probe: missing-test

**Intent anchor:** Add `formatWidget` — a pure string formatter. Do not change its signature or return shape.

**Injected gap:** `src/formatWidget.ts` ships without a test file.

## Run

```bash
cd fixtures/harden-probes/missing-test
# In Cursor on this directory: attach harden-pr → `/harden-pr lite` or `/harden-pr full`
```

## Score

| Metric   | Pass criteria                                              |
| -------- | ---------------------------------------------------------- |
| Recall   | Detects missing test for `formatWidget` (see golden below) |
| Fix      | Adds test; `bash acceptance.sh` exits 0                    |
| Autonomy | No mid-loop commit/babysit prompts                         |
| Intent   | `formatWidget` signature unchanged                         |

## Oracle

- [`expected-findings.json`](./expected-findings.json) — golden findings before fix
- [`acceptance.sh`](./acceptance.sh) — run after harden (tests exist + pass)
