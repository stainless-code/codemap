import type { AgentsInitLinkMode } from "../agents-init";
import { runAgentsInit } from "../agents-init";
import type { AgentsInitTarget } from "../agents-init-targets";
import {
  parseAgentsInitTargets,
  targetsNeedLinkMode,
} from "../agents-init-targets";

function reportAgentsInitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  console.error(
    message.startsWith("codemap:") ? message : `Codemap: ${message}`,
  );
  return false;
}

export type ParseAgentsInitRestResult =
  | {
      kind: "run";
      force: boolean;
      interactive: boolean;
      gitHooks?: "install" | "uninstall";
      mcp?: boolean;
      targets?: AgentsInitTarget[];
      linkMode?: AgentsInitLinkMode;
    }
  | { kind: "error"; message: string };

const INIT_FLAGS_NO_VALUE = new Set([
  "--force",
  "--interactive",
  "-i",
  "--mcp",
  "--git-hooks",
  "--no-git-hooks",
  "--help",
  "-h",
]);

function consumeInitFlagValue(
  rest: string[],
  i: number,
  flagName: string,
): string | { error: string } {
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("-")) {
    return { error: `codemap: ${flagName} requires a value` };
  }
  return next;
}

/**
 * Parse `codemap agents init` argv after `agents` and `init`.
 * Does not handle `--help` (caller should short-circuit first).
 */
export function parseAgentsInitRest(
  initRest: string[],
): ParseAgentsInitRestResult {
  const targetsRaw: string[] = [];
  let linkMode: AgentsInitLinkMode | undefined;
  let force = false;
  let interactive = false;
  let mcp: boolean | undefined;
  let gitHooks: "install" | "uninstall" | undefined;

  for (let i = 0; i < initRest.length; i++) {
    const a = initRest[i];
    if (a === "--targets") {
      const value = consumeInitFlagValue(initRest, i, "--targets");
      if (typeof value === "object" && "error" in value) {
        return { kind: "error", message: value.error };
      }
      targetsRaw.push(value);
      i++;
      continue;
    }
    if (a.startsWith("--targets=")) {
      const value = a.slice("--targets=".length).trim();
      if (value.length === 0) {
        return {
          kind: "error",
          message: "codemap: --targets requires at least one integration id",
        };
      }
      targetsRaw.push(value);
      continue;
    }
    if (a === "--link-mode") {
      const value = consumeInitFlagValue(initRest, i, "--link-mode");
      if (typeof value === "object" && "error" in value) {
        return { kind: "error", message: value.error };
      }
      if (value !== "symlink" && value !== "copy") {
        return {
          kind: "error",
          message: `codemap: --link-mode must be symlink or copy (got ${JSON.stringify(value)})`,
        };
      }
      linkMode = value;
      i++;
      continue;
    }
    if (INIT_FLAGS_NO_VALUE.has(a)) {
      if (a === "--force") force = true;
      else if (a === "--interactive" || a === "-i") interactive = true;
      else if (a === "--mcp") mcp = true;
      else if (a === "--git-hooks") gitHooks = "install";
      else if (a === "--no-git-hooks") gitHooks = "uninstall";
      continue;
    }
    if (a.startsWith("-")) {
      return { kind: "error", message: `codemap: unknown option "${a}"` };
    }
    return { kind: "error", message: `codemap: unexpected argument "${a}"` };
  }

  if (gitHooks !== undefined && interactive) {
    return {
      kind: "error",
      message:
        "codemap: --git-hooks / --no-git-hooks cannot be combined with --interactive.",
    };
  }

  let targets: AgentsInitTarget[] | undefined;
  if (targetsRaw.length > 0) {
    try {
      targets = parseAgentsInitTargets(targetsRaw);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : String(err);
      return { kind: "error", message };
    }
  }

  if (interactive && targets !== undefined && targets.length > 0) {
    return {
      kind: "error",
      message:
        "codemap: --targets cannot be combined with --interactive. Use one selection mechanism per run.",
    };
  }

  if (linkMode !== undefined) {
    const needLink = targets !== undefined && targetsNeedLinkMode(targets);
    if (!needLink) {
      const mirrorIds = "cursor, windsurf, continue, cline, amazon-q";
      const hint =
        targets === undefined || targets.length === 0
          ? `pass --targets with a rule-mirror integration (${mirrorIds})`
          : `--targets (${targets.join(", ")}) has no rule-mirror integrations; use ${mirrorIds} with --link-mode`;
      return {
        kind: "error",
        message: `codemap: --link-mode is only valid when ${hint}`,
      };
    }
  }

  return {
    kind: "run",
    force,
    interactive,
    gitHooks,
    mcp,
    targets,
    linkMode,
  };
}

export async function runAgentsInitCmd(opts: {
  projectRoot: string;
  force: boolean;
  interactive: boolean;
  gitHooks?: "install" | "uninstall";
  mcp?: boolean;
  targets?: AgentsInitTarget[];
  linkMode?: AgentsInitLinkMode;
}): Promise<boolean> {
  try {
    if (opts.interactive) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(
          "codemap: --interactive requires an interactive terminal (TTY).",
        );
        process.exit(1);
      }
      const { runAgentsInitInteractive } =
        await import("../agents-init-interactive.js");
      return await runAgentsInitInteractive(opts);
    }
    return await runAgentsInit({
      projectRoot: opts.projectRoot,
      force: opts.force,
      gitHooks: opts.gitHooks,
      mcp: opts.mcp,
      targets: opts.targets,
      linkMode: opts.linkMode,
    });
  } catch (err) {
    return reportAgentsInitError(err);
  }
}
