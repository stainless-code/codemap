#!/usr/bin/env node
// @ts-check
/** Keep in sync with `src/codemap-invocation.ts`. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCommand } from "package-manager-detector/commands";
import { detect } from "package-manager-detector/detect";

/** @typedef {"project-installed" | "dlx-pinned" | "dlx-latest"} CodemapInstallMethod */
/** @typedef {{ command: string; args: string[]; installMethod: CodemapInstallMethod; agent: string }} ResolvedCodemapInvocation */
/** @typedef {Pick<ResolvedCodemapInvocation, "command" | "args">} CodemapInvocationPrefix */

/** @type {"@stainless-code/codemap"} */
export const CODEMAP_PUBLISHED_NAME = "@stainless-code/codemap";

/** @type {readonly ["@stainless-code/codemap", "codemap"]} */
export const CODEMAP_DEP_KEYS = ["@stainless-code/codemap", "codemap"];

const VALID_AGENTS = new Set(["npm", "pnpm", "yarn", "yarn@berry", "bun"]);

export const SAFE_CODEMAP_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+^-]*$/;

/**
 * MCP JSON: `bunx`, not `bun` + `x`.
 * @param {string} command
 * @param {string[]} args
 * @returns {{ command: string; args: string[] }}
 */
export function normalizeSpawnCommand(command, args) {
  if (command === "bun" && args[0] === "x") {
    return { command: "bunx", args: args.slice(1) };
  }
  return { command, args };
}

/** @param {string} manifestPath @returns {boolean} */
function manifestHasCodemap(manifestPath) {
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const buckets = [
      manifest?.dependencies,
      manifest?.devDependencies,
      manifest?.optionalDependencies,
    ];
    return buckets.some(
      (b) =>
        b !== null &&
        b !== undefined &&
        CODEMAP_DEP_KEYS.some((k) => b[k] !== undefined),
    );
  } catch {
    return false;
  }
}

/** @param {string} workingDir @returns {boolean} */
export function codemapInProjectDependencies(workingDir) {
  let dir = workingDir;
  for (;;) {
    if (manifestHasCodemap(join(dir, "package.json"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** @param {string} version */
export function validateCodemapVersionInput(version) {
  if (version === "") return;
  if (version.includes("\n") || version.includes("\r")) {
    throw new Error("VERSION must not contain line breaks.");
  }
  if (!SAFE_CODEMAP_VERSION_RE.test(version)) {
    throw new Error(
      `VERSION "${version}" contains invalid characters. Use a semver pin or dist-tag (e.g. 1.2.3, latest).`,
    );
  }
}

/**
 * @param {{ projectRoot: string; packageManager?: string; version?: string }} opts
 * @returns {Promise<ResolvedCodemapInvocation>}
 */
export async function resolveCodemapCliInvocation(opts) {
  const projectRoot = opts.projectRoot;
  const versionInput = (opts.version ?? "").trim();
  validateCodemapVersionInput(versionInput);

  let agent = (opts.packageManager ?? "").trim();
  if (agent !== "" && !VALID_AGENTS.has(agent)) {
    throw new Error(
      `package-manager "${agent}" not recognised. Expected one of: ${[...VALID_AGENTS].join(", ")}.`,
    );
  }
  if (agent === "") {
    const detected = await detect({ cwd: projectRoot });
    agent = detected?.agent ?? "npm";
  }

  /** @type {"execute" | "execute-local"} */
  let intent;
  /** @type {string[]} */
  let commandArgs;
  /** @type {CodemapInstallMethod} */
  let installMethod;
  if (versionInput !== "") {
    intent = "execute";
    commandArgs = [`${CODEMAP_PUBLISHED_NAME}@${versionInput}`];
    installMethod = "dlx-pinned";
  } else if (codemapInProjectDependencies(projectRoot)) {
    intent = "execute-local";
    commandArgs = ["codemap"];
    installMethod = "project-installed";
  } else {
    intent = "execute";
    commandArgs = [`${CODEMAP_PUBLISHED_NAME}@latest`];
    installMethod = "dlx-latest";
  }

  const resolved = resolveCommand(agent, intent, commandArgs);
  if (resolved === null) {
    throw new Error(
      `package-manager-detector returned null for agent="${agent}", intent="${intent}".`,
    );
  }
  const normalized = normalizeSpawnCommand(resolved.command, resolved.args);
  return {
    ...normalized,
    installMethod,
    agent,
  };
}

/** @param {boolean | undefined} includeWorkspaceRoot @returns {string[]} */
export function codemapMcpTailArgs(includeWorkspaceRoot) {
  const args = ["mcp", "--watch"];
  if (includeWorkspaceRoot === true) {
    args.push("--root", "${workspaceFolder}");
  }
  return args;
}

/**
 * @param {CodemapInvocationPrefix} invocation
 * @param {boolean | undefined} includeWorkspaceRoot
 * @returns {{ command: string; args: string[] }}
 */
export function buildCodemapMcpSpawn(invocation, includeWorkspaceRoot) {
  return {
    command: invocation.command,
    args: [...invocation.args, ...codemapMcpTailArgs(includeWorkspaceRoot)],
  };
}

/** Action `GITHUB_OUTPUT`. @param {CodemapInvocationPrefix} invocation @returns {string} */
export function formatCodemapExec(invocation) {
  return [invocation.command, ...invocation.args].join(" ");
}
