#!/usr/bin/env bun
// Run a package script against every changed file — working tree + staged +
// untracked, deduplicated — the single definition behind the `*:changes`
// scripts. Usage: bun scripts/run-on-changed-files.ts <package-script>
// Exits 0 quietly when nothing changed.
import { $ } from "bun";

const task = process.argv[2];
if (!task) {
  console.error("usage: bun scripts/run-on-changed-files.ts <package-script>");
  process.exit(1);
}

const [unstaged, staged, untracked] = await Promise.all([
  $`git diff --name-only --diff-filter=ACMR`.text(),
  $`git diff --name-only --cached --diff-filter=ACMR`.text(),
  $`git ls-files --others --exclude-standard`.text(),
]);

const files = [
  ...new Set(
    [unstaged, staged, untracked]
      .join("\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
].sort();

if (files.length === 0) process.exit(0);

const proc = Bun.spawnSync(["bun", "run", task, ...files], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(proc.exitCode ?? 1);
