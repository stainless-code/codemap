#!/usr/bin/env node
/**
 * Action pre-step: detect the host project's package manager + resolve the
 * codemap CLI invocation. Wraps `package-manager-detector` (antfu/userquin,
 * MIT, 0 transitive deps). Outputs are written to `$GITHUB_OUTPUT` per
 * GitHub Actions' current convention (`::set-output` was deprecated 2022-10).
 *
 * Inputs (env, all optional):
 *   PACKAGE_MANAGER       Override autodetect with explicit `npm|pnpm|yarn|bun`.
 *   VERSION               Pin codemap CLI version (e.g. `1.2.3`).
 *                         Empty → use project-installed binary if present,
 *                         else fall back to `<pm> dlx codemap@latest`.
 *   WORKING_DIRECTORY     Where to start the lockfile + package.json walk.
 *                         Defaults to process.cwd() (the runner's repo root).
 *
 * Outputs (written to $GITHUB_OUTPUT):
 *   agent                 Resolved package manager (`npm` / `pnpm` / `yarn` / `bun`).
 *   exec                  Shell-ready command to run codemap (e.g.
 *                         `pnpm exec codemap` or `pnpm dlx codemap@1.2.3`).
 *   install_method        `project-installed` | `dlx-pinned` | `dlx-latest`
 *                         (debug breadcrumb; surfaces in Action logs).
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

  // Step 1: resolve the agent.
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

  // Step 2: resolve the CLI invocation per Q3's three-branch logic.
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

  // Step 3: write to $GITHUB_OUTPUT.
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile === undefined || outputFile === "") {
    // Local / non-Actions invocation — print to stdout for inspection.
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

/**
 * Read `<workingDir>/package.json` and check whether `codemap` is a
 * direct dependency. Returns `false` on read errors / missing manifest.
 */
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
