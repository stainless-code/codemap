import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseScenariosJson } from "../query-golden/schema";
import { envPath, validateProbesAgainstGolden } from "./capture-real-sessions";
import { parseProbesJson } from "./schema";

const EVAL_DIR = join(import.meta.dir);
const REPO_ROOT = join(EVAL_DIR, "../..");

describe("capture-real-sessions helpers", () => {
  test("envPath treats empty string like unset", () => {
    const prior = process.env.CAPTURE_TEST_PATH;
    process.env.CAPTURE_TEST_PATH = "";
    expect(envPath("CAPTURE_TEST_PATH", "/fallback")).toBe("/fallback");
    if (prior === undefined) delete process.env.CAPTURE_TEST_PATH;
    else process.env.CAPTURE_TEST_PATH = prior;
  });

  test("validateProbesAgainstGolden accepts minimal fixture probes", () => {
    const probes = parseProbesJson(
      readFileSync(join(EVAL_DIR, "scenarios.json"), "utf-8"),
    ).probes;
    const scenariosPath = join(REPO_ROOT, "fixtures/golden/scenarios.json");
    const { scenarios } = parseScenariosJson(
      readFileSync(scenariosPath, "utf-8"),
    );
    const goldenById = new Map(scenarios.map((s) => [s.id, s]));
    expect(() =>
      validateProbesAgainstGolden(probes, goldenById, scenariosPath),
    ).not.toThrow();
  });

  test("validateProbesAgainstGolden rejects unknown goldenId", () => {
    const probes = parseProbesJson(
      readFileSync(join(EVAL_DIR, "scenarios.json"), "utf-8"),
    ).probes;
    const goldenById = new Map<string, { id: string }>();
    expect(() =>
      validateProbesAgainstGolden(
        probes,
        goldenById as never,
        "/tmp/scenarios.json",
      ),
    ).toThrow(/not found/);
  });
});
