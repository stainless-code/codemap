import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadScenariosFromConfigFile } from "./benchmark-config";
import { getDefaultScenarios } from "./benchmark-default-scenarios";
import type { Scenario } from "./benchmark-default-scenarios";
import { loadUserConfig, resolveCodemapConfig } from "./config";
import { closeDb, openDb } from "./db";
import { configureResolver } from "./resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "./runtime";

const VERBOSE = process.argv.includes("--verbose");

const bootstrapRoot =
  process.env.CODEMAP_ROOT !== undefined
    ? resolve(process.env.CODEMAP_ROOT)
    : process.env.CODEMAP_TEST_BENCH !== undefined
      ? resolve(process.env.CODEMAP_TEST_BENCH)
      : process.cwd();

if (
  process.env.CODEMAP_ROOT !== undefined ||
  process.env.CODEMAP_TEST_BENCH !== undefined
) {
  if (!existsSync(bootstrapRoot) || !statSync(bootstrapRoot).isDirectory()) {
    console.error(
      `\n  CODEMAP_ROOT / CODEMAP_TEST_BENCH is not an existing directory:\n    ${bootstrapRoot}\n\n  Use the real absolute path to the project (documentation paths like /path/to/repo are placeholders).\n  Example: CODEMAP_ROOT=$HOME/your-org/your-app bun src/benchmark.ts\n`,
    );
    process.exit(1);
  }
}

const userConfig = await loadUserConfig(bootstrapRoot);
initCodemap(resolveCodemapConfig(bootstrapRoot, userConfig));
configureResolver(getProjectRoot(), getTsconfigPath());

function timeMs(fn: () => unknown): { result: unknown; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

async function timeMsAsync(
  fn: () => Promise<unknown>,
): Promise<{ result: unknown; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

interface Row {
  scenario: string;
  indexedMs: string;
  indexedMsRaw: number;
  indexedResults: number;
  traditionalMs: string;
  traditionalMsRaw: number;
  traditionalResults: number;
  filesRead: number;
  bytesRead: string;
  bytesReadRaw: number;
  speedup: string;
}

const db = openDb();

const configPath = process.env.CODEMAP_BENCHMARK_CONFIG;
let scenarios: Scenario[];
if (configPath !== undefined && configPath !== "") {
  const resolvedConfig = resolve(configPath);
  const loaded = loadScenariosFromConfigFile(db, configPath);
  if (loaded.replaceDefault) {
    scenarios = loaded.scenarios;
  } else {
    scenarios = [...getDefaultScenarios(db), ...loaded.scenarios];
  }
  const mergeNote = loaded.replaceDefault ? "" : " + defaults";
  console.log(
    `\n  Codemap — Benchmark (${scenarios.length} scenario(s)${mergeNote} from ${resolvedConfig})\n`,
  );
} else {
  scenarios = getDefaultScenarios(db);
  console.log("\n  Codemap — Benchmark\n");
}

db.query("SELECT COUNT(*) FROM files").get();

const rows: Row[] = [];

for (const s of scenarios) {
  const idx = timeMs(s.indexed);
  const idxResults = idx.result as unknown[];

  const trad = timeMs(s.traditional);
  const tradResult = trad.result as {
    results: unknown[];
    filesRead: number;
    bytesRead: number;
  };

  const speedup = trad.ms / Math.max(idx.ms, 0.001);

  rows.push({
    scenario: s.name,
    indexedMs: fmtMs(idx.ms),
    indexedMsRaw: idx.ms,
    indexedResults: idxResults.length,
    traditionalMs: fmtMs(trad.ms),
    traditionalMsRaw: trad.ms,
    traditionalResults: tradResult.results.length,
    filesRead: tradResult.filesRead,
    bytesRead: fmtBytes(tradResult.bytesRead),
    bytesReadRaw: tradResult.bytesRead,
    speedup: `${speedup.toFixed(0)}×`,
  });

  if (VERBOSE) {
    console.log(`  ─ ${s.name}`);
    console.log(
      `    Index:       ${fmtMs(idx.ms)} → ${idxResults.length} results`,
    );
    console.log(
      `    Traditional: ${fmtMs(trad.ms)} → ${tradResult.results.length} results (read ${tradResult.filesRead} files, ${fmtBytes(tradResult.bytesRead)})`,
    );
    console.log(`    Speedup:     ${speedup.toFixed(0)}×`);
    if (idxResults.length > 0 && idxResults.length <= 5) {
      console.log(`    Sample:`, JSON.stringify(idxResults[0]).slice(0, 120));
    }
    console.log();
  }
}

closeDb(db);

console.log(
  "  ┌─────────────────────────────────────────────┬────────────┬─────────┬──────────────┬─────────┬───────────┬───────────┬─────────┐",
);
console.log(
  "  │ Scenario                                    │ Index Time │ Results │ Trad. Time   │ Results │ Files Rd. │ Bytes Rd. │ Speedup │",
);
console.log(
  "  ├─────────────────────────────────────────────┼────────────┼─────────┼──────────────┼─────────┼───────────┼───────────┼─────────┤",
);
for (const r of rows) {
  console.log(
    `  │ ${r.scenario.padEnd(43)} │ ${r.indexedMs.padStart(10)} │ ${String(r.indexedResults).padStart(7)} │ ${r.traditionalMs.padStart(12)} │ ${String(r.traditionalResults).padStart(7)} │ ${String(r.filesRead).padStart(9)} │ ${r.bytesRead.padStart(9)} │ ${r.speedup.padStart(7)} │`,
  );
}
console.log(
  "  └─────────────────────────────────────────────┴────────────┴─────────┴──────────────┴─────────┴───────────┴───────────┴─────────┘",
);

const totalIdxMs = rows.reduce((s, r) => s + r.indexedMsRaw, 0);
const totalTradMs = rows.reduce((s, r) => s + r.traditionalMsRaw, 0);
console.log(
  `\n  Totals: Index ${fmtMs(totalIdxMs)} vs Traditional ${fmtMs(totalTradMs)} (${(totalTradMs / Math.max(totalIdxMs, 0.001)).toFixed(1)}× overall)\n`,
);

const avgTokensPerByte = 0.25;
const totalBytesTraditional = rows.reduce((s, r) => s + r.bytesReadRaw, 0);
const estimatedTokens = Math.round(totalBytesTraditional * avgTokensPerByte);
console.log(`  Token impact estimate:`);
console.log(
  `    Traditional approach reads ~${fmtBytes(totalBytesTraditional)} of source across all scenarios`,
);
console.log(
  `    ≈ ${estimatedTokens.toLocaleString()} tokens at ~4 bytes/token`,
);
console.log(
  `    Index queries return only matching rows → negligible token cost\n`,
);

const INDEXER_PATH = join(import.meta.dirname, "index.ts");

async function benchmarkReindex(label: string, args: string[]) {
  const runs = 3;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = await timeMsAsync(async () => {
      const proc = Bun.spawn(["bun", INDEXER_PATH, ...args], {
        cwd: getProjectRoot(),
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode;
    });
    times.push(t.ms);
  }
  const avg = times.reduce((a, b) => a + b, 0) / runs;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { label, avg, min, max, runs };
}

console.log("  ─── Reindex Benchmarks ───\n");

const SAMPLE_FILES = (
  process.env.CODEMAP_BENCHMARK_FILES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? ["package.json", "README.md", "tsconfig.json"]
).filter((p) => existsSync(join(getProjectRoot(), p)));

const reindexResults = [];
if (SAMPLE_FILES.length > 0) {
  reindexResults.push(
    await benchmarkReindex(`Targeted (${SAMPLE_FILES.length} files)`, [
      "--files",
      ...SAMPLE_FILES,
    ]),
  );
} else {
  console.warn(
    "  Skipping targeted reindex: set CODEMAP_BENCHMARK_FILES or add package.json/README.md/tsconfig.json under CODEMAP_ROOT\n",
  );
}
reindexResults.push(await benchmarkReindex("Incremental (no changes)", []));
reindexResults.push(await benchmarkReindex("Full rebuild", ["--full"]));

console.log(
  "  ┌──────────────────────────────┬──────────┬──────────┬──────────┬──────┐",
);
console.log(
  "  │ Scenario                     │ Avg      │ Min      │ Max      │ Runs │",
);
console.log(
  "  ├──────────────────────────────┼──────────┼──────────┼──────────┼──────┤",
);
for (const r of reindexResults) {
  console.log(
    `  │ ${r.label.padEnd(28)} │ ${fmtMs(r.avg).padStart(8)} │ ${fmtMs(r.min).padStart(8)} │ ${fmtMs(r.max).padStart(8)} │ ${String(r.runs).padStart(4)} │`,
  );
}
console.log(
  "  └──────────────────────────────┴──────────┴──────────┴──────────┴──────┘\n",
);
