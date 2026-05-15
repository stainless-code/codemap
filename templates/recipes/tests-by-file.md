---
actions:
  - type: review-test-coverage
    description: "Test-file roll-up: describes / tests / skipped / .only / todos per file with detected framework. Cross-reference against coverage for files-without-tests audits."
---

# tests-by-file

Test counts per test file. Useful for surfacing high-density test files (potential split candidates) and zero-test source files (cross-reference against coverage).

```bash
codemap query --recipe tests-by-file
```

`framework` is detected per file from imports — `vitest` / `jest` / `bun-test` / `node-test` / `mocha` / `unknown` (legacy mocha-style global describes with no imports).
