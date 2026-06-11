import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const SCORE = join(import.meta.dir, "score-probe.mjs");
const PROBE = join(ROOT, "fixtures/harden-probes/missing-test");

describe("score-probe.mjs", () => {
  it("passes when actual matches golden file+production_bar", () => {
    const dir = mkdtempSync(join(tmpdir(), "harden-score-"));
    const findings = join(dir, "findings.json");
    writeFileSync(
      findings,
      readFileSync(join(PROBE, "expected-findings.json")),
    );
    const r = spawnSync("bun", [SCORE, PROBE, findings], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.pass).toBe(true);
    expect(report.recall).toBe(1);
  });

  it("fails when golden row missing from actual", () => {
    const dir = mkdtempSync(join(tmpdir(), "harden-score-"));
    const findings = join(dir, "findings.json");
    writeFileSync(findings, "[]");
    const r = spawnSync("bun", [SCORE, PROBE, findings], { encoding: "utf8" });
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.pass).toBe(false);
    expect(report.missed.length).toBeGreaterThan(0);
  });
});
