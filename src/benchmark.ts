/**
 * Benchmark: Codebase Index (SQL) vs Traditional File Scanning
 *
 * Compares two approaches to answering common code-discovery questions:
 *   1. Indexed — single SQL query against .codemap.db
 *   2. Traditional — Glob + readFileSync + regex (simulates what AI tools do)
 *
 * Usage:
 *   bun src/benchmark.ts
 *   CODEMAP_ROOT=/path/to/repo bun src/benchmark.ts --verbose
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import fg from "fast-glob";

import { loadUserConfig, resolveCodemapConfig } from "./config";
import { closeDb, openDb } from "./db";
import { configureResolver } from "./resolver";
import {
  getProjectRoot,
  getTsconfigPath,
  initCodemap,
  isPathExcluded,
} from "./runtime";

const VERBOSE = process.argv.includes("--verbose");

const bootstrapRoot = process.env.CODEMAP_ROOT
  ? resolve(process.env.CODEMAP_ROOT)
  : process.cwd();
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

function globFiles(patterns: string[], cwd: string): string[] {
  const files: string[] = [];
  for (const pattern of patterns) {
    files.push(...fg.sync(pattern, { cwd, dot: true }));
  }
  return files;
}

function globFilesFiltered(patterns: string[], cwd: string): string[] {
  return globFiles(patterns, cwd).filter((p) => !isPathExcluded(p));
}

function readAll(
  paths: string[],
  cwd: string,
): { totalBytes: number; contents: Map<string, string> } {
  let totalBytes = 0;
  const contents = new Map<string, string>();
  for (const p of paths) {
    try {
      const content = readFileSync(join(cwd, p), "utf-8");
      totalBytes += Buffer.byteLength(content);
      contents.set(p, content);
    } catch {}
  }
  return { totalBytes, contents };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

interface Scenario {
  name: string;
  indexed: () => unknown[];
  traditional: () => {
    results: unknown[];
    filesRead: number;
    bytesRead: number;
  };
}

const db = openDb();

const scenarios: Scenario[] = [
  {
    name: "Find where 'usePermissions' is defined",
    indexed: () =>
      db
        .query(
          `SELECT file_path, line_start, line_end, signature
           FROM symbols WHERE name = 'usePermissions' AND kind IN ('function', 'variable')`,
        )
        .all(),
    traditional: () => {
      const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /export\s+(?:function|const)\s+usePermissions/;
      const results = [];
      for (const [path, content] of contents) {
        if (re.test(content)) results.push({ file_path: path });
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "List React components (TSX/JSX)",
    indexed: () =>
      db.query(`SELECT name, file_path FROM components ORDER BY name`).all(),
    traditional: () => {
      const files = globFilesFiltered(["**/*.{tsx,jsx}"], getProjectRoot());
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/g;
      const results = [];
      for (const [path, content] of contents) {
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push({ file_path: path, name: m[1] });
        }
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "Files that import from ~/api/client",
    indexed: () =>
      db
        .query(
          `SELECT file_path FROM imports
           WHERE source LIKE '~/api/client%'
           GROUP BY file_path`,
        )
        .all(),
    traditional: () => {
      const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /from\s+['"]~\/api\/client/;
      const results = [];
      for (const [path, content] of contents) {
        if (re.test(content)) results.push({ file_path: path });
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "Find all TODO/FIXME markers",
    indexed: () =>
      db
        .query(`SELECT file_path, line_number, content, kind FROM markers`)
        .all(),
    traditional: () => {
      const files = globFilesFiltered(
        ["**/*.{ts,tsx,css,md}"],
        getProjectRoot(),
      );
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /\b(TODO|FIXME|HACK|NOTE)[\s:]+(.+)/g;
      const results = [];
      for (const [path, content] of contents) {
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push({ file_path: path, kind: m[1], text: m[2]?.trim() });
        }
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "CSS design tokens (custom properties)",
    indexed: () =>
      db
        .query(
          `SELECT name, value, scope, file_path FROM css_variables ORDER BY name LIMIT 50`,
        )
        .all(),
    traditional: () => {
      const files = globFilesFiltered(["**/*.css"], getProjectRoot());
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /(--[\w-]+)\s*:\s*([^;]+)/g;
      const results = [];
      for (const [path, content] of contents) {
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push({ file_path: path, name: m[1], value: m[2]?.trim() });
        }
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "Components in `shop/` subtree",
    indexed: () =>
      db
        .query(
          `SELECT name, file_path FROM components
           WHERE file_path LIKE '%/components/%shop%'
           ORDER BY name`,
        )
        .all(),
    traditional: () => {
      const files = globFilesFiltered(
        ["**/components/shop/**/*.tsx"],
        getProjectRoot(),
      );
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /export\s+(?:default\s+)?(?:function|const)\s+(\w+)/g;
      const results = [];
      for (const [path, content] of contents) {
        let m;
        while ((m = re.exec(content)) !== null) {
          results.push({ file_path: path, name: m[1] });
        }
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },

  {
    name: "Reverse deps: who imports utils/date?",
    indexed: () =>
      db
        .query(
          `SELECT from_path FROM dependencies
           WHERE to_path LIKE '%utils/date%'`,
        )
        .all(),
    traditional: () => {
      const files = globFilesFiltered(["**/*.{ts,tsx}"], getProjectRoot());
      const { totalBytes, contents } = readAll(files, getProjectRoot());
      const re = /from\s+['"].*utils\/date['"]/;
      const results = [];
      for (const [path, content] of contents) {
        if (re.test(content)) results.push({ file_path: path });
      }
      return { results, filesRead: files.length, bytesRead: totalBytes };
    },
  },
];

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

// Warmup query to prime SQLite page cache
db.query("SELECT COUNT(*) FROM files").get();

console.log("\n  Codemap — Benchmark\n");

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

const avgTokensPerByte = 0.25; // ~4 bytes per token (rough)
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
