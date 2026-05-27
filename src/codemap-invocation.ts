import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolveCommand } from "package-manager-detector/commands";
import { detect } from "package-manager-detector/detect";

/** Keep `scripts/codemap-invocation.mjs` in sync. */

export const CODEMAP_PUBLISHED_NAME = "@stainless-code/codemap";

export const CODEMAP_DEP_KEYS = ["@stainless-code/codemap", "codemap"] as const;

export type CodemapInstallMethod =
  | "project-installed"
  | "dlx-pinned"
  | "dlx-latest";

export interface ResolvedCodemapInvocation {
  command: string;
  args: string[];
  installMethod: CodemapInstallMethod;
  agent: string;
}

const VALID_AGENTS = new Set(["npm", "pnpm", "yarn", "yarn@berry", "bun"]);

export const SAFE_CODEMAP_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+^-]*$/;

/** MCP JSON executables use `bunx`, not `bun` + `x`. */
export function normalizeSpawnCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (command === "bun" && args[0] === "x") {
    return { command: "bunx", args: args.slice(1) };
  }
  return { command, args };
}

function manifestHasCodemap(manifestPath: string): boolean {
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const buckets = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
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

export function codemapInProjectDependencies(workingDir: string): boolean {
  let dir = workingDir;
  for (;;) {
    if (manifestHasCodemap(join(dir, "package.json"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function validateCodemapVersionInput(version: string): void {
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

/** `package-manager-detector` reports Berry as `{ agent: "yarn", version: "berry" }`. */
function normalizeDetectedAgent(
  detected: { agent?: string; version?: string } | null | undefined,
): string {
  const agent = detected?.agent ?? "npm";
  if (agent === "yarn" && detected?.version === "berry") {
    return "yarn@berry";
  }
  return agent;
}

export async function resolveCodemapCliInvocation(opts: {
  projectRoot: string;
  packageManager?: string | undefined;
  version?: string | undefined;
}): Promise<ResolvedCodemapInvocation> {
  const versionInput = (opts.version ?? "").trim();
  validateCodemapVersionInput(versionInput);

  let agent = (opts.packageManager ?? "").trim();
  if (agent !== "" && !VALID_AGENTS.has(agent)) {
    throw new Error(
      `package-manager "${agent}" not recognised. Expected one of: ${[...VALID_AGENTS].join(", ")}.`,
    );
  }
  if (agent === "") {
    const detected = await detect({ cwd: opts.projectRoot });
    agent = normalizeDetectedAgent(detected);
  }

  let intent: "execute" | "execute-local";
  let commandArgs: string[];
  let installMethod: CodemapInstallMethod;
  if (versionInput !== "") {
    intent = "execute";
    commandArgs = [`${CODEMAP_PUBLISHED_NAME}@${versionInput}`];
    installMethod = "dlx-pinned";
  } else if (codemapInProjectDependencies(opts.projectRoot)) {
    intent = "execute-local";
    commandArgs = ["codemap"];
    installMethod = "project-installed";
  } else {
    intent = "execute";
    commandArgs = [`${CODEMAP_PUBLISHED_NAME}@latest`];
    installMethod = "dlx-latest";
  }

  const resolved = resolveCommand(
    agent as "npm" | "pnpm" | "yarn" | "yarn@berry" | "bun",
    intent,
    commandArgs,
  );
  if (resolved === null) {
    throw new Error(
      `package-manager-detector returned null for agent="${agent}", intent="${intent}". ` +
        `Check that the agent supports this intent (npm/pnpm/yarn/yarn@berry/bun execute-local or dlx).`,
    );
  }
  const normalized = normalizeSpawnCommand(resolved.command, resolved.args);
  return {
    ...normalized,
    installMethod,
    agent,
  };
}

function codemapMcpTailArgs(
  includeWorkspaceRoot: boolean | undefined,
): string[] {
  const args = ["mcp", "--watch"];
  if (includeWorkspaceRoot === true) {
    args.push("--root", "${workspaceFolder}");
  }
  return args;
}

export function buildCodemapMcpSpawn(
  invocation: Pick<ResolvedCodemapInvocation, "command" | "args">,
  includeWorkspaceRoot: boolean | undefined,
): { command: string; args: string[] } {
  return {
    command: invocation.command,
    args: [...invocation.args, ...codemapMcpTailArgs(includeWorkspaceRoot)],
  };
}

export function formatCodemapExec(
  invocation: Pick<ResolvedCodemapInvocation, "command" | "args">,
): string {
  return [invocation.command, ...invocation.args].join(" ");
}
