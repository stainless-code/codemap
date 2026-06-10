#!/usr/bin/env bun
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { IndexPerformanceReport } from "../src/application/types";

// 25% threshold + 10ms noise floor gate real regressions, not jitter; docs/benchmark.md § Perf baseline.
const NOISE_FLOOR_MS = Number(process.env.CODEMAP_PERF_NOISE_FLOOR_MS ?? 10);
const REGRESSION_PCT = Number(process.env.CODEMAP_PERF_REGRESSION_PCT ?? 25);
const RUNS_RAW = Number(process.env.CODEMAP_PERF_RUNS ?? 3);
if (!Number.isInteger(RUNS_RAW) || RUNS_RAW < 1) {
  console.error(
    `CODEMAP_PERF_RUNS must be a positive integer (got ${process.env.CODEMAP_PERF_RUNS ?? RUNS_RAW})`,
  );
  process.exit(2);
}
const RUNS = RUNS_RAW;

const REPO_ROOT = resolve(import.meta.dirname, "..");
const INDEXER = join(REPO_ROOT, "src/index.ts");
const BASELINE = join(REPO_ROOT, "fixtures/benchmark/perf-baseline.json");
const TMP_JSON = join(REPO_ROOT, ".perf-run.json");

const UPDATE_MODE = process.argv.includes("--update");
/** Idle skip should stay well under full git churn; catches fallback to git log. */
const IDLE_CHURN_MAX_MS = Number(
  process.env.CODEMAP_PERF_IDLE_CHURN_MAX_MS ?? 50,
);

type ReportPhase = keyof Pick<
  IndexPerformanceReport,
  | "collect_ms"
  | "parse_ms"
  | "insert_ms"
  | "index_create_ms"
  | "bindings_ms"
  | "module_cycles_ms"
  | "re_export_chains_ms"
  | "churn_ms"
  | "total_ms"
>;

/** Baseline-gated phases — `churn_idle_ms` is idle incremental `churn_ms`, not full-rebuild. */
type GatedPhase = ReportPhase | "churn_idle_ms";

const GATED_PHASES: GatedPhase[] = [
  "collect_ms",
  "parse_ms",
  "insert_ms",
  "index_create_ms",
  "bindings_ms",
  "churn_ms",
  "churn_idle_ms",
  "total_ms",
];

/** Per-phase noise floors — `churn_idle_ms` is meta + rev-parse only, often < global floor. */
const PHASE_NOISE_FLOOR_MS: Partial<Record<GatedPhase, number>> = {
  churn_idle_ms: 5,
};

interface PhaseStats {
  median: number;
  min: number;
  max: number;
  runs: number[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function runFullOnce(): Promise<IndexPerformanceReport> {
  if (existsSync(TMP_JSON)) rmSync(TMP_JSON);
  const proc = Bun.spawn(["bun", INDEXER, "--full", "--performance"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CODEMAP_PERFORMANCE_JSON: TMP_JSON },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`indexer failed (exit ${exitCode}): ${stderr}`);
  }
  if (!existsSync(TMP_JSON)) {
    throw new Error(`indexer did not write ${TMP_JSON}`);
  }
  return JSON.parse(readFileSync(TMP_JSON, "utf-8")) as IndexPerformanceReport;
}

async function runIdleChurnOnce(): Promise<number> {
  if (existsSync(TMP_JSON)) rmSync(TMP_JSON);
  const proc = Bun.spawn(["bun", INDEXER, "--performance"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CODEMAP_PERFORMANCE_JSON: TMP_JSON },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`idle indexer failed (exit ${exitCode}): ${stderr}`);
  }
  if (!existsSync(TMP_JSON)) {
    throw new Error(`idle indexer did not write ${TMP_JSON}`);
  }
  const report = JSON.parse(
    readFileSync(TMP_JSON, "utf-8"),
  ) as IndexPerformanceReport;
  if (report.churn_ms > IDLE_CHURN_MAX_MS) {
    throw new Error(
      `idle churn_ms=${report.churn_ms} exceeds ${IDLE_CHURN_MAX_MS} — idle skip may have failed (full git churn path?)`,
    );
  }
  return report.churn_ms;
}

function noiseFloorFor(phase: GatedPhase, baseline: BaselineFile): number {
  return PHASE_NOISE_FLOOR_MS[phase] ?? baseline.noise_floor_ms;
}

async function collectStats(): Promise<Record<GatedPhase, PhaseStats>> {
  console.error(`Running indexer ${RUNS}× to collect per-phase medians…`);
  const reports: IndexPerformanceReport[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await runFullOnce();
    reports.push(r);
    console.error(
      `  run ${i + 1}/${RUNS}: total_ms=${r.total_ms} bindings_ms=${r.bindings_ms} churn_ms=${r.churn_ms}`,
    );
  }

  console.error(`Running idle incremental ${RUNS}× for churn_idle_ms…`);
  const idleRuns: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const churnMs = await runIdleChurnOnce();
    idleRuns.push(churnMs);
    console.error(`  idle ${i + 1}/${RUNS}: churn_ms=${churnMs}`);
  }

  if (existsSync(TMP_JSON)) rmSync(TMP_JSON);

  const out = {} as Record<GatedPhase, PhaseStats>;
  for (const phase of GATED_PHASES) {
    if (phase === "churn_idle_ms") {
      out[phase] = {
        median: median(idleRuns),
        min: Math.min(...idleRuns),
        max: Math.max(...idleRuns),
        runs: idleRuns,
      };
      continue;
    }
    const runs = reports.map((r) => r[phase]);
    out[phase] = {
      median: median(runs),
      min: Math.min(...runs),
      max: Math.max(...runs),
      runs,
    };
  }
  return out;
}

interface BaselineFile {
  captured_at: string;
  commit: string;
  phases: Record<GatedPhase, number>;
  /** Percent above baseline median that triggers a regression. */
  regression_pct: number;
  /** Phases under this median (ms) skip gating — jitter dominates. */
  noise_floor_ms: number;
}

function loadBaseline(): BaselineFile | null {
  if (!existsSync(BASELINE)) return null;
  return JSON.parse(readFileSync(BASELINE, "utf-8")) as BaselineFile;
}

function gitHead(): string {
  try {
    const out = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
    });
    return new TextDecoder().decode(out.stdout).trim();
  } catch {
    return "unknown";
  }
}

function pct(current: number, baseline: number): string {
  if (baseline === 0) return current === 0 ? "0%" : "+∞%";
  const delta = ((current - baseline) / baseline) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

async function main() {
  const stats = await collectStats();

  if (UPDATE_MODE) {
    const baseline: BaselineFile = {
      captured_at: new Date().toISOString(),
      commit: gitHead(),
      phases: Object.fromEntries(
        GATED_PHASES.map((p) => [p, stats[p].median]),
      ) as Record<GatedPhase, number>,
      regression_pct: REGRESSION_PCT,
      noise_floor_ms: NOISE_FLOOR_MS,
    };
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nBaseline written to ${BASELINE}`);
    console.log(JSON.stringify(baseline, null, 2));
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(
      `No baseline at ${BASELINE}. Run with --update to create one.`,
    );
    process.exit(2);
  }

  console.log("\nPer-phase comparison vs baseline (median over runs):");
  console.log(
    "┌─────────────────────┬──────────┬──────────┬─────────┬──────────┐",
  );
  console.log(
    "│ Phase               │ Baseline │  Current │   Delta │ Gated?   │",
  );
  console.log(
    "├─────────────────────┼──────────┼──────────┼─────────┼──────────┤",
  );

  const regressionPct =
    process.env.CODEMAP_PERF_REGRESSION_PCT != null
      ? REGRESSION_PCT
      : baseline.regression_pct;

  let regressed = false;
  for (const phase of GATED_PHASES) {
    const base = baseline.phases[phase];
    const cur = stats[phase].median;
    const gated = base >= noiseFloorFor(phase, baseline);
    const overBudget = gated && cur > base * (1 + regressionPct / 100);
    if (overBudget) regressed = true;
    const flag = gated ? (overBudget ? "REGRESS" : "ok") : "skip(noise)";
    console.log(
      `│ ${phase.padEnd(19)} │ ${String(base).padStart(8)} │ ${String(cur).padStart(8)} │ ${pct(cur, base).padStart(7)} │ ${flag.padEnd(8)} │`,
    );
  }
  console.log(
    "└─────────────────────┴──────────┴──────────┴─────────┴──────────┘",
  );
  console.log(
    `\nBaseline: ${baseline.commit.slice(0, 8)} @ ${baseline.captured_at}`,
  );
  console.log(
    `Threshold: +${regressionPct}%; noise floor: ${baseline.noise_floor_ms}ms`,
  );

  if (regressed) {
    console.error("\nRegression detected. Fail.");
    console.error(
      "If the regression is intentional, capture a new baseline with `bun run check:perf-baseline:update`.",
    );
    process.exit(1);
  }
  console.log("\nNo regressions.");
}

await main();
