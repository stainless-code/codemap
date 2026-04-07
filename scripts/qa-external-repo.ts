#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCodemap } from "../src/api";

const CODEMAP_REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]) {
  let root: string | undefined;
  let skipBenchmark = false;
  let verboseBenchmark = false;
  let help = false;
  let maxFiles = 200;
  let maxSymbols = 25;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--skip-benchmark") skipBenchmark = true;
    else if (a === "--verbose") verboseBenchmark = true;
    else if (a === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (a === "--max-files" && argv[i + 1]) maxFiles = Number(argv[++i]);
    else if (a === "--max-symbols" && argv[i + 1])
      maxSymbols = Number(argv[++i]);
    else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
  }
  return { root, skipBenchmark, verboseBenchmark, help, maxFiles, maxSymbols };
}

function resolveExternalRoot(cliRoot: string | undefined): string {
  const raw =
    cliRoot ?? process.env.CODEMAP_ROOT ?? process.env.CODEMAP_TEST_BENCH;
  if (raw === undefined || raw === "") {
    console.error(
      "Set CODEMAP_ROOT or CODEMAP_TEST_BENCH to the project root (absolute path), or pass --root.\n" +
        "Example: CODEMAP_ROOT=/path/to/app bun run qa:external\n" +
        "Copy .env.example to .env in this repo and set CODEMAP_TEST_BENCH for day-to-day.\n",
    );
    process.exit(1);
  }
  return resolve(raw);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: CODEMAP_ROOT=DIR bun scripts/qa-external-repo.ts [options]
       bun scripts/qa-external-repo.ts --root DIR [options]

  Root: --root overrides CODEMAP_ROOT and CODEMAP_TEST_BENCH (same precedence as the CLI).

  --root DIR          Optional; overrides env when you do not want .env
  --skip-benchmark    Only run index + sanity checks (no SQL vs glob benchmark)
  --verbose           Pass --verbose to src/benchmark.ts
  --max-files N       Cap indexed file paths to check on disk (default 200)
  --max-symbols N     Cap symbol line checks (default 25)
  -h, --help
`);
  process.exit(0);
}

const root = resolveExternalRoot(args.root);
process.env.CODEMAP_ROOT = root;

async function main(): Promise<void> {
  console.log(`\n  === codemap qa:external ===\n  root: ${root}\n`);

  const cm = await createCodemap({ root });
  const indexResult = await cm.index({ mode: "full", quiet: true });
  console.log(
    `  Index: full rebuild in ${indexResult.elapsedMs.toFixed(0)}ms (indexed ${indexResult.indexed}, skipped ${indexResult.skipped})\n`,
  );

  let failed = 0;

  // --- Files: paths in DB exist on disk ---
  const fileRows = cm.query("SELECT path FROM files ORDER BY path") as {
    path: string;
  }[];
  const totalFiles = fileRows.length;
  const take = Math.min(args.maxFiles, totalFiles);
  const step =
    totalFiles <= take ? 1 : Math.max(1, Math.floor(totalFiles / take));
  let checked = 0;
  for (let i = 0; i < totalFiles && checked < take; i += step) {
    const fp = fileRows[i]!.path;
    const abs = join(root, fp);
    if (!existsSync(abs)) {
      console.error(`  FAIL files: missing on disk: ${fp}`);
      failed++;
    }
    checked++;
  }
  console.log(
    `  Files on disk: checked ${checked}/${totalFiles} sampled paths (step ${step}) — ${failed === 0 ? "ok" : `${failed} missing`}`,
  );

  // --- Symbols: declaration line contains the symbol name ---
  const symRows = cm.query(
    `SELECT name, file_path, line_start FROM symbols
     WHERE line_start IS NOT NULL AND length(name) >= 2
     ORDER BY file_path, line_start
     LIMIT ${Math.max(1, args.maxSymbols * 4)}`,
  ) as { name: string; file_path: string; line_start: number }[];

  const generic = new Set([
    "default",
    "constructor",
    "length",
    "name",
    "toString",
    "valueOf",
  ]);
  let symChecked = 0;
  for (const row of symRows) {
    if (symChecked >= args.maxSymbols) break;
    if (generic.has(row.name)) continue;
    symChecked++;
    const abs = join(root, row.file_path);
    if (!existsSync(abs)) {
      console.error(
        `  FAIL symbols: file missing for symbol ${row.name}: ${row.file_path}`,
      );
      failed++;
      continue;
    }
    const text = readFileSync(abs, "utf-8");
    const lines = text.split(/\r?\n/);
    const line = lines[row.line_start - 1];
    if (line === undefined) {
      console.error(
        `  FAIL symbols: line ${row.line_start} out of range in ${row.file_path}`,
      );
      failed++;
      continue;
    }
    if (!line.includes(row.name)) {
      console.error(
        `  FAIL symbols: line ${row.line_start} in ${row.file_path} does not contain "${row.name}"`,
      );
      console.error(`    ${line.slice(0, 200)}`);
      failed++;
    }
  }
  console.log(
    `  Symbol lines: checked ${symChecked} rows — ${failed === 0 ? "ok" : "see errors above"}`,
  );

  // --- Informative samples (manual cross-check with chat / Read tool) ---
  console.log(
    "\n  --- Sample queries (compare with repo by hand or agent) ---\n",
  );
  const fanOut = cm.query(
    `SELECT from_path, COUNT(*) AS deps FROM dependencies GROUP BY from_path ORDER BY deps DESC LIMIT 5`,
  );
  console.log("  Top dependency fan-out (first 5):");
  console.log(JSON.stringify(fanOut, null, 2));
  const comps = cm.query(
    `SELECT name, file_path FROM components ORDER BY name LIMIT 8`,
  );
  if (Array.isArray(comps) && comps.length > 0) {
    console.log("\n  Components (up to 8):");
    console.log(JSON.stringify(comps, null, 2));
  } else {
    console.log(
      "\n  (no React components in index — expected if no JSX in corpus)",
    );
  }

  if (args.skipBenchmark) {
    console.log(
      `\n  Skipped benchmark (--skip-benchmark).\n  === qa:external done (exit ${failed > 0 ? 1 : 0}) ===\n`,
    );
    process.exit(failed > 0 ? 1 : 0);
    return;
  }

  console.log("\n  --- Running src/benchmark.ts (same CODEMAP_ROOT) ---\n");
  const benchArgs = ["src/benchmark.ts"];
  if (args.verboseBenchmark) benchArgs.push("--verbose");
  const proc = Bun.spawn(["bun", ...benchArgs], {
    cwd: CODEMAP_REPO,
    env: { ...process.env, CODEMAP_ROOT: root },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`\n  benchmark.ts exited with ${code}`);
    process.exit(code ?? 1);
  }

  console.log(
    `\n  === qa:external done — structural checks: ${failed === 0 ? "pass" : "FAIL"} ===\n` +
      `  Next: run the same prompts with/without Codemap in chat and paste exports for diff review.\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
