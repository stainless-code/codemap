#!/usr/bin/env bun
/**
 * Compares stdout size and line count for `codemap query` (console.table) vs `codemap query --json`
 * against the current project's `.codemap.db`. Run from the repo root after indexing:
 *
 *   bun src/index.ts
 *   bun scripts/benchmark-query-output.ts
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_TS = join(REPO_ROOT, "src/index.ts");

type Scenario = { label: string; args: string[] };

const SCENARIOS: Scenario[] = [
  {
    label: "symbols LIMIT 120 (name, kind, file_path, line_start, line_end)",
    args: [
      "query",
      "--json",
      `SELECT name, kind, file_path, line_start, line_end FROM symbols ORDER BY file_path, line_start LIMIT 120`,
    ],
  },
  {
    label: "all dependency edges (from_path, to_path)",
    args: [
      "query",
      "--json",
      `SELECT from_path, to_path FROM dependencies ORDER BY from_path, to_path`,
    ],
  },
  {
    label: "recipe fan-out-sample",
    args: ["query", "--json", "--recipe", "fan-out-sample"],
  },
];

function runQuery(args: string[]): { stdout: string; exitCode: number } {
  const bun = Bun.which("bun");
  if (bun === null) {
    throw new Error("bun not found on PATH");
  }
  const proc = Bun.spawnSync([bun, INDEX_TS, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  if (stderr.length > 0 && proc.exitCode !== 0) {
    console.error(stderr);
  }
  return { stdout, exitCode: proc.exitCode ?? 1 };
}

function metrics(stdout: string): { lines: number; bytes: number } {
  const bytes = Buffer.byteLength(stdout, "utf8");
  const normalized = stdout.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.length === 0 ? 0 : normalized.split("\n").length;
  return { lines, bytes };
}

function jsonArgsToDefaultArgs(args: string[]): string[] {
  const i = args.indexOf("--json");
  if (i === -1) {
    return args;
  }
  return args.slice(0, i).concat(args.slice(i + 1));
}

function main(): void {
  const dbPath = join(REPO_ROOT, ".codemap.db");
  if (!existsSync(dbPath)) {
    console.error(
      `No index at ${dbPath}. Run: bun src/index.ts (from repo root), then re-run this script.`,
    );
    process.exit(1);
  }

  console.log(
    "codemap query output: default (console.table) vs --json\n" +
      `cwd: ${REPO_ROOT}\n`,
  );

  for (const { label, args } of SCENARIOS) {
    const defaultArgs = jsonArgsToDefaultArgs(args);
    const a = runQuery(defaultArgs);
    const b = runQuery(args);
    if (a.exitCode !== 0 || b.exitCode !== 0) {
      console.error(`Scenario failed: ${label}`);
      console.error("default exit:", a.exitCode, "json exit:", b.exitCode);
      process.exit(1);
    }

    const ma = metrics(a.stdout);
    const mb = metrics(b.stdout);
    const pct =
      ma.bytes > 0 ? ((1 - mb.bytes / ma.bytes) * 100).toFixed(1) : "0.0";

    console.log(`— ${label}`);
    console.log(
      `  lines:   ${String(ma.lines).padStart(5)} (table)  ${String(mb.lines).padStart(5)} (json)`,
    );
    console.log(
      `  bytes:   ${String(ma.bytes).padStart(5)} (table)  ${String(mb.bytes).padStart(5)} (json)  (~${pct}% smaller with --json)`,
    );
    console.log("");
  }
}

main();
