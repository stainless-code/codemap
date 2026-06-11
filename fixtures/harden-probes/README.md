# Harden-pr eval probes

Manual workflow eval fixtures for [`.agents/skills/harden-pr/SKILL.md`](../../.agents/skills/harden-pr/SKILL.md). Not shipped in npm.

Each probe is a small corpus with **injected production-bar gaps** and a golden finding oracle. Agents run `/harden-pr` against the probe; humans score recall, precision, and autonomy.

| Probe           | Injected gap             | Production bar |
| --------------- | ------------------------ | -------------- |
| `missing-test/` | New export, no unit test | Tests          |

See [benchmark.md § Harden-pr workflow eval](../../docs/benchmark.md#harden-pr-workflow-eval).
