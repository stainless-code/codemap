import { describe, expect, it } from "bun:test";
/**
 * Guardrail: golden scenarios stay aligned with bundled recipes and substrate tables.
 * Run via `bun run test:scripts` (included in `bun run check`).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CAPABILITIES_PATH = join(REPO_ROOT, "fixtures/CAPABILITIES.json");
const SCENARIOS_PATH = join(REPO_ROOT, "fixtures/golden/scenarios.json");
const RECIPES_DIR = join(REPO_ROOT, "templates/recipes");
const GOLDEN_DIR = join(REPO_ROOT, "fixtures/golden/minimal");

/** Tables that must have a dedicated SQL pin-down scenario (not recipe-only). */
const SUBSTRATE_SCENARIO_BY_TABLE = {
  file_metrics: "file-metrics-complexity-fixture",
  scopes: "scopes-product-card",
  references: "references-product-card-perms",
  bindings: "bindings-createClient",
  import_specifiers: "import-specifiers-consumer",
  async_calls: "async-calls-prefetch",
  decorators: "decorators-sealed",
  dynamic_imports: "dynamic-imports-prefetch",
  module_cycles: "module-cycles-cache-store",
  re_export_chains: "re-export-chains-product-card",
  runtime_markers: "runtime-markers-env",
  function_params: "function-params-createClient",
  boundary_rules: "boundary-rules-ui-no-api",
  unresolved_calls: "unresolved-call-sites",
  calls: "calls-createClient-resolved",
  coverage: "coverage-rows-after-ingest",
  jsx_elements: "index-table-stats",
  jsx_attributes: "index-table-stats",
  try_catch: "try-catch-rethrow-heuristics",
  jsdoc_tags: "jsdoc-tags-createClient",
  suppressions: "suppressions-orphan",
  source_fts: "source-fts-row-count",
  meta: "meta-fts5-enabled",
};

function loadScenarios() {
  const raw = JSON.parse(readFileSync(SCENARIOS_PATH, "utf-8"));
  return Array.isArray(raw) ? raw : raw.scenarios;
}

describe("golden coverage matrix", () => {
  const scenarios = loadScenarios();
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const recipeIdsInScenarios = new Set(
    scenarios.filter((s) => s.recipe).map((s) => s.recipe),
  );

  it("every bundled recipe id appears in at least one golden scenario", () => {
    const bundled = readdirSync(RECIPES_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""));
    const missing = bundled.filter((id) => !recipeIdsInScenarios.has(id));
    expect(missing).toEqual([]);
  });

  it("every substrate table has a pin-down or aggregate golden scenario", () => {
    const missing = Object.entries(SUBSTRATE_SCENARIO_BY_TABLE)
      .filter(([, id]) => !scenarioIds.has(id))
      .map(([table]) => table);
    expect(missing).toEqual([]);
  });

  it("every exact-match scenario has a committed golden JSON file", () => {
    const missing = scenarios
      .filter((s) => !s.match || s.match.kind === "exact")
      .map((s) => s.id)
      .filter((id) => !existsSync(join(GOLDEN_DIR, `${id}.json`)));
    expect(missing).toEqual([]);
  });

  it("index-table-stats locks fetchTableStats-shaped counts", () => {
    expect(scenarioIds.has("index-table-stats")).toBe(true);
    const scenario = scenarios.find((s) => s.id === "index-table-stats");
    expect(scenario?.sql).toContain("FROM file_metrics");
    expect(scenario?.sql).toContain("FROM unresolved_calls");
    expect(scenario?.sql).toContain('FROM "references"');
  });

  it("fixtures/CAPABILITIES.json goldenScenarios exist in scenarios.json", () => {
    const manifest = JSON.parse(readFileSync(CAPABILITIES_PATH, "utf-8"));
    const missing = [];
    for (const cap of manifest.capabilities ?? []) {
      for (const id of cap.goldenScenarios ?? []) {
        if (!scenarioIds.has(id)) missing.push(`${cap.id}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("fixtures/CAPABILITIES.json fixtureFiles exist under corpus", () => {
    const manifest = JSON.parse(readFileSync(CAPABILITIES_PATH, "utf-8"));
    const root = join(REPO_ROOT, manifest.corpusRoot ?? "fixtures/minimal");
    const missing = [];
    for (const cap of manifest.capabilities ?? []) {
      for (const rel of cap.fixtureFiles ?? []) {
        if (!existsSync(join(root, rel))) missing.push(`${cap.id}:${rel}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
