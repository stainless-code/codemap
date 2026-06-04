import { describe, expect, it } from "bun:test";
/**
 * Each CAPABILITIES.json group with goldenScenarios must have ≥1 agent-eval probe
 * pointing at one of those scenario ids.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseProbesJson } from "./schema.ts";

const REPO_ROOT = join(import.meta.dir, "../..");
const CAPABILITIES_PATH = join(REPO_ROOT, "fixtures/CAPABILITIES.json");
const PROBES_PATH = join(import.meta.dir, "scenarios.json");

const SKIP_CAPABILITY = new Set([
  "recipes.bundled",
  "cli.bench-smoke",
  "cli.mcp.http",
]);

describe("agent-eval capability probe coverage", () => {
  it("every capability with goldens has a probe referencing one of its scenario ids", () => {
    const manifest = JSON.parse(readFileSync(CAPABILITIES_PATH, "utf-8"));
    const { probes } = parseProbesJson(readFileSync(PROBES_PATH, "utf-8"));
    const probeGoldenIds = new Set(probes.map((p) => p.goldenId));

    const missing = [];
    for (const cap of manifest.capabilities ?? []) {
      if (SKIP_CAPABILITY.has(cap.id)) continue;
      const goldens = cap.goldenScenarios ?? [];
      if (goldens.length === 0) continue;
      const covered = goldens.some((id) => probeGoldenIds.has(id));
      if (!covered) missing.push(cap.id);
    }
    expect(missing).toEqual([]);
  });
});
