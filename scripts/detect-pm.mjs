#!/usr/bin/env node
/**
 * Action pre-step. Resolves package manager + codemap CLI invocation;
 * writes to `$GITHUB_OUTPUT` (`::set-output` deprecated 2022-10).
 *
 * Env contract:
 *   PACKAGE_MANAGER     Override autodetect (npm|pnpm|yarn|yarn@berry|bun).
 *   VERSION             Pin codemap CLI version; empty → project-installed → dlx-latest.
 *   WORKING_DIRECTORY   Lockfile + package.json walk root (default cwd).
 *
 * Outputs: `agent` / `exec` (shell-ready) / `install_method` (debug breadcrumb).
 *
 * Q2 + Q3 of docs/plans/github-marketplace-action.md.
 */

import { appendFileSync } from "node:fs";
import process from "node:process";

import {
  formatCodemapExec,
  resolveCodemapCliInvocation,
} from "./codemap-invocation.mjs";

async function main() {
  const explicitAgent = (process.env["PACKAGE_MANAGER"] ?? "").trim();
  const versionInput = (process.env["VERSION"] ?? "").trim();
  const workingDir =
    (process.env["WORKING_DIRECTORY"] ?? "").trim() || process.cwd();

  const resolved = await resolveCodemapCliInvocation({
    projectRoot: workingDir,
    packageManager: explicitAgent !== "" ? explicitAgent : undefined,
    version: versionInput !== "" ? versionInput : undefined,
  });
  const exec = formatCodemapExec(resolved);

  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile === undefined || outputFile === "") {
    console.log(`agent=${resolved.agent}`);
    console.log(`exec=${exec}`);
    console.log(`install_method=${resolved.installMethod}`);
    return;
  }
  appendFileSync(
    outputFile,
    formatGithubOutput({
      agent: resolved.agent,
      exec,
      install_method: resolved.installMethod,
    }),
  );
}

/** One `key=value` line per entry; multiline values use Actions heredoc syntax. */
function formatGithubOutput(entries) {
  let block = "";
  for (const [key, value] of Object.entries(entries)) {
    if (/[\n\r]/.test(value)) {
      block += `${key}<<EOF\n${value}\nEOF\n`;
    } else {
      block += `${key}=${value}\n`;
    }
  }
  return block;
}

function fail(message) {
  console.error(`detect-pm: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
