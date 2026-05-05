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

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { resolveCommand } from "package-manager-detector/commands";
import { detect } from "package-manager-detector/detect";

const VALID_AGENTS = new Set(["npm", "pnpm", "yarn", "yarn@berry", "bun"]);

async function main() {
  const explicitAgent = (process.env["PACKAGE_MANAGER"] ?? "").trim();
  const versionInput = (process.env["VERSION"] ?? "").trim();
  const workingDir =
    (process.env["WORKING_DIRECTORY"] ?? "").trim() || process.cwd();

  let agent;
  if (explicitAgent !== "") {
    if (!VALID_AGENTS.has(explicitAgent)) {
      fail(
        `package-manager input "${explicitAgent}" not recognised. Expected one of: ${[...VALID_AGENTS].join(", ")}.`,
      );
    }
    agent = explicitAgent;
  } else {
    const detected = await detect({ cwd: workingDir });
    agent = detected?.agent ?? "npm";
  }

  // Per Q3's three-branch resolution (docs/plans/github-marketplace-action.md).
  let intent;
  let commandArgs;
  let installMethod;
  if (versionInput !== "") {
    intent = "execute";
    commandArgs = [`codemap@${versionInput}`];
    installMethod = "dlx-pinned";
  } else if (codemapInDevDependencies(workingDir)) {
    intent = "execute-local";
    commandArgs = ["codemap"];
    installMethod = "project-installed";
  } else {
    intent = "execute";
    commandArgs = ["codemap@latest"];
    installMethod = "dlx-latest";
  }

  const resolved = resolveCommand(agent, intent, commandArgs);
  if (resolved === null) {
    fail(
      `package-manager-detector returned null for agent="${agent}", intent="${intent}". This usually means the agent doesn't support that intent (e.g. deno's execute-local).`,
    );
  }
  const { command, args } = resolved;
  const exec = [command, ...args].join(" ");

  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile === undefined || outputFile === "") {
    // Local / non-Actions invocation: dump to stdout.
    console.log(`agent=${agent}`);
    console.log(`exec=${exec}`);
    console.log(`install_method=${installMethod}`);
    return;
  }
  appendFileSync(
    outputFile,
    `agent=${agent}\nexec=${exec}\ninstall_method=${installMethod}\n`,
  );
}

/** False on read errors / missing manifest. */
function codemapInDevDependencies(workingDir) {
  try {
    const manifestPath = join(workingDir, "package.json");
    if (!existsSync(manifestPath)) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return Boolean(
      manifest?.dependencies?.codemap ||
      manifest?.devDependencies?.codemap ||
      manifest?.optionalDependencies?.codemap,
    );
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`detect-pm: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
