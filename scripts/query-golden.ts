#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../src/api";
import { ingestIstanbul, ingestLcov } from "../src/application/coverage-engine";
import { queryRows } from "../src/application/index-engine";
import {
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "../src/application/query-recipes";
import { resolveRecipeParams } from "../src/application/recipe-params";
import type { RecipeParamValue } from "../src/application/recipe-params";
import { closeDb, openDb } from "../src/db";
import { parseScenariosJson } from "./query-golden/schema";
import type {
  GoldenMatch,
  GoldenScenario,
  GoldenSetupStep,
} from "./query-golden/schema";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  let update = false;
  let help = false;
  let strictBudget = false;
  let corpus: "minimal" | "external" = "minimal";
  let root: string | undefined;
  let scenariosPath: string | undefined;
  let goldenDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update") update = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a === "--strict-budget") strictBudget = true;
    else if (a === "--corpus" && argv[i + 1]) {
      const v = argv[++i];
      if (v !== "minimal" && v !== "external") {
        throw new Error(`--corpus must be minimal or external, got "${v}"`);
      }
      corpus = v;
    } else if (a === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (a === "--scenarios" && argv[i + 1]) {
      scenariosPath = resolve(argv[++i]);
    } else if (a === "--golden-dir" && argv[i + 1]) {
      goldenDir = resolve(argv[++i]);
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
  }
  return { update, help, strictBudget, corpus, root, scenariosPath, goldenDir };
}

const argv = parseArgs(process.argv.slice(2));
const UPDATE = argv.update;
const HELP = argv.help;
const STRICT_BUDGET = argv.strictBudget;

if (HELP) {
  console.log(`Usage: bun scripts/query-golden.ts [options]

Corpus:
  --corpus minimal     (default) fixtures/minimal + fixtures/golden/scenarios.json
  --corpus external    Index CODEMAP_ROOT or --root; scenarios from scenarios.external.json
                       if present, else scenarios.external.example.json; goldens in
                       fixtures/golden/external/ (gitignored — for local / private trees)

Options:
  --root DIR           Project root for --corpus external (else CODEMAP_ROOT / CODEMAP_TEST_BENCH)
  --scenarios FILE     Override scenarios JSON path
  --golden-dir DIR     Override golden JSON directory
  --update             Rewrite golden files from current indexer output
  --strict-budget      Exit 1 if any scenario exceeds budgetMs (default: warn only)
  --help, -h
`);
  process.exit(0);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringify(x)).join(",")}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function resolveQuery(s: GoldenScenario): {
  sql: string;
  bindValues: RecipeParamValue[];
} {
  if (s.sql !== undefined) {
    if (s.params !== undefined) {
      throw new Error(
        `Scenario "${s.id}": params are only supported with recipe-based scenarios; raw SQL scenarios must not declare params.`,
      );
    }
    return { sql: s.sql, bindValues: [] };
  }
  if (s.recipe !== undefined) {
    const sql = getQueryRecipeSql(s.recipe);
    if (sql === undefined) {
      throw new Error(`Scenario "${s.id}": unknown recipe "${s.recipe}"`);
    }
    const resolved = resolveRecipeParams({
      recipeId: s.recipe,
      declared: getQueryRecipeParams(s.recipe),
      provided: s.params,
    });
    if (!resolved.ok) {
      throw new Error(`Scenario "${s.id}": ${resolved.error}`);
    }
    return { sql, bindValues: resolved.values };
  }
  throw new Error(`Scenario "${s.id}": missing sql or recipe`);
}

function defaultMatch(s: GoldenScenario): GoldenMatch {
  return s.match ?? { kind: "exact" };
}

/**
 * Run one-time setup steps after the corpus is indexed and before the first
 * scenario. Today: `ingest-coverage` (Istanbul / LCOV — auto-detected by
 * extension, mirrors the CLI verb). Extend the dispatch as more one-shot
 * ingest verbs land.
 */
function runSetup(steps: GoldenSetupStep[], fixtureRoot: string): void {
  const db = openDb();
  try {
    for (const step of steps) {
      if (step.kind !== "ingest-coverage") continue;
      const absPath = resolve(fixtureRoot, step.path);
      if (absPath.endsWith(".json")) {
        const payload = JSON.parse(
          readFileSync(absPath, "utf-8"),
        ) as Parameters<typeof ingestIstanbul>[0]["payload"];
        ingestIstanbul({
          db,
          projectRoot: fixtureRoot,
          payload,
          sourcePath: absPath,
        });
      } else if (absPath.endsWith(".info")) {
        ingestLcov({
          db,
          projectRoot: fixtureRoot,
          payload: readFileSync(absPath, "utf-8"),
          sourcePath: absPath,
        });
      } else {
        throw new Error(
          `query-golden setup: cannot auto-detect coverage format from ${absPath}`,
        );
      }
    }
  } finally {
    closeDb(db);
  }
}

function evaluateMatch(
  rows: unknown[],
  match: GoldenMatch,
): { ok: boolean; detail: string } {
  if (match.kind === "exact") {
    return { ok: true, detail: "" };
  }
  if (match.kind === "minRows") {
    const ok = rows.length >= match.min;
    return {
      ok,
      detail: ok
        ? ""
        : `minRows: expected >= ${match.min} rows, got ${rows.length}`,
    };
  }
  if (match.kind === "everyRowContains") {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r === null || typeof r !== "object") {
        return {
          ok: false,
          detail: `everyRowContains: row ${i} is not an object`,
        };
      }
      const o = r as Record<string, unknown>;
      const v = o[match.field];
      if (typeof v !== "string" || !v.includes(match.includes)) {
        return {
          ok: false,
          detail: `everyRowContains: row ${i} field ${JSON.stringify(match.field)} must include ${JSON.stringify(match.includes)}`,
        };
      }
    }
    return { ok: true, detail: "" };
  }
  return { ok: false, detail: "unknown match kind" };
}

async function main(): Promise<void> {
  const envRoot = process.env.CODEMAP_ROOT ?? process.env.CODEMAP_TEST_BENCH;

  let fixtureRoot: string;
  let scenariosFile: string;
  let goldenDir: string;

  if (argv.corpus === "minimal") {
    fixtureRoot = join(REPO_ROOT, "fixtures/minimal");
    scenariosFile =
      argv.scenariosPath ?? join(REPO_ROOT, "fixtures/golden/scenarios.json");
    goldenDir = argv.goldenDir ?? join(REPO_ROOT, "fixtures/golden/minimal");
  } else {
    const rootArg = argv.root ?? (envRoot ? resolve(envRoot) : undefined);
    if (rootArg === undefined) {
      throw new Error(
        "--corpus external requires --root or CODEMAP_ROOT / CODEMAP_TEST_BENCH",
      );
    }
    fixtureRoot = rootArg;
    scenariosFile =
      argv.scenariosPath ??
      (existsSync(join(REPO_ROOT, "fixtures/golden/scenarios.external.json"))
        ? join(REPO_ROOT, "fixtures/golden/scenarios.external.json")
        : join(REPO_ROOT, "fixtures/golden/scenarios.external.example.json"));
    goldenDir = argv.goldenDir ?? join(REPO_ROOT, "fixtures/golden/external");
  }

  const raw = readFileSync(scenariosFile, "utf-8");
  const { setup, scenarios } = parseScenariosJson(raw);

  mkdirSync(goldenDir, { recursive: true });

  const cm = await createCodemap({ root: fixtureRoot });
  await cm.index({ mode: "full", quiet: true });
  if (setup.length > 0) runSetup(setup, fixtureRoot);

  const modeLabel = UPDATE ? "--update" : "compare";
  const corpusLabel = argv.corpus;
  console.log(`\n  === query-golden ${modeLabel} (${corpusLabel}) ===`);
  if (UPDATE) {
    console.log(`  (rewriting ${goldenDir}/*.json)\n`);
  } else {
    console.log(`  (${fixtureRoot} indexed vs ${goldenDir}/)\n`);
  }

  let failed = 0;
  let budgetFailures = 0;

  for (const s of scenarios) {
    const { sql, bindValues } = resolveQuery(s);
    const t0 = performance.now();
    const rows = queryRows(sql, bindValues) as unknown[];
    const durationMs = performance.now() - t0;
    const match = defaultMatch(s);

    if (s.budgetMs !== undefined && durationMs > s.budgetMs) {
      const msg = `  budget: ${s.id} took ${durationMs.toFixed(1)}ms (limit ${s.budgetMs}ms)`;
      if (STRICT_BUDGET) {
        console.error(msg);
        budgetFailures++;
      } else {
        console.warn(msg);
      }
    }

    const goldenPath = join(goldenDir, `${s.id}.json`);

    if (UPDATE) {
      writeFileSync(goldenPath, `${JSON.stringify(rows, null, 2)}\n`, "utf-8");
      console.log(`  updated ${goldenPath}`);
      continue;
    }

    if (match.kind === "exact") {
      if (!existsSync(goldenPath)) {
        console.error(`  FAIL: ${s.id} (exact match requires ${goldenPath})`);
        failed++;
        continue;
      }
      const expectedRaw = readFileSync(goldenPath, "utf-8");
      const expected = stableStringify(JSON.parse(expectedRaw) as unknown[]);
      const actual = stableStringify(rows);
      if (actual !== expected) {
        console.error(`  FAIL: ${s.id}`);
        console.error(`    expected: ${expected}`);
        console.error(`    actual:   ${actual}`);
        failed++;
      } else {
        console.log(`  ok ${s.id}`);
      }
      continue;
    }

    const ev = evaluateMatch(rows, match);
    if (!ev.ok) {
      console.error(`  FAIL: ${s.id}`);
      console.error(`    ${ev.detail}`);
      failed++;
    } else {
      console.log(`  ok ${s.id} (${match.kind})`);
    }
  }

  if (UPDATE) {
    console.log(
      "\n  Golden files updated. Review diffs before committing.\n  === end query-golden --update (exit 0) ===\n",
    );
    return;
  }

  if (budgetFailures > 0) {
    console.error(
      `\n  query-golden: ${budgetFailures} scenario(s) exceeded budget (--strict-budget).\n`,
    );
    process.exit(1);
  }

  if (failed > 0) {
    console.error(`\n  query-golden: ${failed} scenario(s) failed.\n`);
    process.exit(1);
  }
  console.log(
    `\n  query-golden: all scenarios passed.\n  === end query-golden compare (exit 0) ===\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
