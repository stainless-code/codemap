#!/usr/bin/env bun
/**
 * Score harden-pr probe findings against expected-findings.json oracle.
 *
 * Usage:
 *   bun scripts/harden-probes/score-probe.mjs <probeDir> <findings.json>
 *   bun scripts/harden-probes/score-probe.mjs fixtures/harden-probes/missing-test findings.json
 *
 * Recall: golden rows matched when same `file` + `production_bar` appear in actual.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [, , probeDirArg, findingsArg] = process.argv;
if (!probeDirArg || !findingsArg) {
  console.error("Usage: score-probe.mjs <probeDir> <findings.json>");
  process.exit(2);
}

const probeDir = resolve(probeDirArg);
const golden = JSON.parse(
  readFileSync(join(probeDir, "expected-findings.json"), "utf8"),
);
const actual = JSON.parse(readFileSync(resolve(findingsArg), "utf8"));

function key(row) {
  return `${row.file}\0${row.production_bar}`;
}

const goldenKeys = new Set(golden.map(key));
const actualKeys = new Set(actual.map(key));

const matched = [...goldenKeys].filter((k) => actualKeys.has(k));
const missed = [...goldenKeys].filter((k) => !actualKeys.has(k));
const extra = [...actualKeys].filter((k) => !goldenKeys.has(k));

const recall = golden.length === 0 ? 1 : matched.length / golden.length;

const report = {
  probeDir,
  goldenCount: golden.length,
  actualCount: actual.length,
  matched: matched.length,
  recall,
  missed: missed.map((k) => {
    const [file, production_bar] = k.split("\0");
    return { file, production_bar };
  }),
  extra: extra.map((k) => {
    const [file, production_bar] = k.split("\0");
    return { file, production_bar };
  }),
  pass: recall >= 1 && missed.length === 0,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
