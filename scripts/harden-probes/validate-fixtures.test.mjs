import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const PROBES_ROOT = join(ROOT, "fixtures/harden-probes");
const SCENARIOS = join(ROOT, "scripts/agent-eval/harden-scenarios.json");

const FINDING_KEYS = [
  "finding",
  "severity",
  "file",
  "line",
  "confidence",
  "effort",
  "fixable_in_bounds",
  "production_bar",
];

describe("harden-probes fixtures", () => {
  it("harden-scenarios.json references valid probe dirs", () => {
    const { scenarios } = JSON.parse(readFileSync(SCENARIOS, "utf8"));
    for (const s of scenarios) {
      const dir = join(ROOT, s.probeDir);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "expected-findings.json"))).toBe(true);
      expect(existsSync(join(dir, "acceptance.sh"))).toBe(true);
    }
  });

  it("each probe expected-findings.json matches schema", () => {
    const probeDirs = readdirSync(PROBES_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "node_modules")
      .map((d) => join(PROBES_ROOT, d.name));

    expect(probeDirs.length).toBeGreaterThan(0);

    for (const dir of probeDirs) {
      const goldenPath = join(dir, "expected-findings.json");
      if (!existsSync(goldenPath)) continue;
      const findings = JSON.parse(readFileSync(goldenPath, "utf8"));
      expect(Array.isArray(findings)).toBe(true);
      for (const row of findings) {
        for (const key of FINDING_KEYS) {
          expect(row).toHaveProperty(key);
        }
        expect(["blocker", "major", "minor", "nit", "info"]).toContain(
          row.severity,
        );
        expect(["high", "medium", "low"]).toContain(row.confidence);
        expect(["S", "M", "L"]).toContain(row.effort);
      }
    }
  });
});
