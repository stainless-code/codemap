# Codemap in-repo test bench

**Single committed corpus** for regression-testing Codemap — no `CODEMAP_ROOT` pointing at external apps required for maintainers or CI.

| Piece                   | Path                                                                                    | Role                                                      |
| ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Corpus**              | [`minimal/`](./minimal/)                                                                | Source tree indexed by goldens, benchmark, agent-eval     |
| **Golden scenarios**    | [`golden/scenarios.json`](./golden/scenarios.json)                                      | Tier A scenario inventory (SQL + recipe ids)              |
| **Golden snapshots**    | [`golden/minimal/`](./golden/minimal/)                                                  | Expected query JSON (committed)                           |
| **Capability map**      | [`CAPABILITIES.json`](./CAPABILITIES.json)                                              | Capability groups → fixture files → `goldenScenarios` ids |
| **Agent eval**          | [`agent-eval/`](../scripts/agent-eval/) + probes in `scripts/agent-eval/scenarios.json` | MCP-on vs traditional arms                                |
| **Benchmark scenarios** | [`benchmark/scenarios.example.json`](./benchmark/scenarios.example.json)                | Speed comparisons (optional override)                     |

## Commands (from repo root)

```bash
bun run test:golden          # index minimal + compare all scenarios
bun run test:agent-eval      # probe/live harness on same corpus
bun run check                # unit + golden + agent-eval (CI)
bun scripts/query-golden.ts --update   # refresh snapshots after intentional changes
```

## Tier B / external trees

`bun run test:golden:external` remains for **consumers** validating Codemap against a private checkout (gitignored goldens). It is **not** part of the Codemap maintainer test bench.

Expansion plan: [docs/plans/in-repo-test-bench.md](../docs/plans/in-repo-test-bench.md).
