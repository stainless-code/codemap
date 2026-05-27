import { join } from "node:path";

import type { AgentsInitTarget } from "./agents-init-targets";

/** Stable id for each MCP writer `agents init --mcp` can target. */
export type AgentsInitMcpTarget =
  | "cursor"
  | "claude-code"
  | "vscode"
  | "continue"
  | "cline"
  | "amazon-q"
  | "amazon-q-default"
  | "gemini"
  | "windsurf";

export type McpConfigScope = "project" | "user-global";

/** JSON shape the host expects for the codemap server entry. */
export type McpConfigFormat = "mcpServers" | "vscode-servers" | "amazon-q-ide";

export interface AgentsInitMcpTargetDef {
  readonly id: AgentsInitMcpTarget;
  readonly displayName: string;
  readonly scope: McpConfigScope;
  readonly format: McpConfigFormat;
  /** Log label (may use `~` for user-global paths). */
  readonly label: string;
  /** Path segments relative to project root or user home. */
  readonly pathSegments: readonly string[];
  readonly docsUrl: string;
  /** Written by default when `--mcp` has no integration filter. */
  readonly defaultOnMcp: boolean;
  /** Cursor / VS Code: inject `--root ${workspaceFolder}`. */
  readonly workspaceRootArg?: boolean | undefined;
  /** Matching `agents init --interactive` integration pick, when any. */
  readonly integrationTarget?: AgentsInitTarget | undefined;
  readonly postWriteNote?: string | undefined;
}

/**
 * Single registry for MCP targets — paths, formats, defaults, and docs links.
 * Update here first; `docs/agents.md` MCP table should stay aligned.
 */
export const AGENTS_INIT_MCP_REGISTRY: readonly AgentsInitMcpTargetDef[] =
  Object.freeze([
    {
      id: "cursor",
      displayName: "Cursor",
      scope: "project",
      format: "mcpServers",
      label: ".cursor/mcp.json",
      pathSegments: [".cursor", "mcp.json"],
      docsUrl: "https://docs.cursor.com/context/model-context-protocol",
      defaultOnMcp: true,
      workspaceRootArg: true,
      integrationTarget: "cursor",
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      scope: "project",
      format: "mcpServers",
      label: ".mcp.json (Claude Code)",
      pathSegments: [".mcp.json"],
      docsUrl: "https://code.claude.com/docs/en/mcp",
      defaultOnMcp: true,
      integrationTarget: "claude-md",
    },
    {
      id: "vscode",
      displayName: "VS Code / Copilot",
      scope: "project",
      format: "vscode-servers",
      label: ".vscode/mcp.json (VS Code / Copilot)",
      pathSegments: [".vscode", "mcp.json"],
      docsUrl:
        "https://code.visualstudio.com/docs/copilot/reference/mcp-configuration",
      defaultOnMcp: true,
      workspaceRootArg: true,
      integrationTarget: "copilot",
    },
    {
      id: "continue",
      displayName: "Continue",
      scope: "project",
      format: "mcpServers",
      label: ".continue/mcpServers/codemap-mcp.json",
      pathSegments: [".continue", "mcpServers", "codemap-mcp.json"],
      docsUrl: "https://docs.continue.dev/customize/deep-dives/mcp",
      defaultOnMcp: true,
      integrationTarget: "continue",
    },
    {
      id: "cline",
      displayName: "Cline",
      scope: "project",
      format: "mcpServers",
      label: ".cline/mcp.json (Cline)",
      pathSegments: [".cline", "mcp.json"],
      docsUrl: "https://docs.cline.bot/cli/cli-reference",
      defaultOnMcp: true,
      integrationTarget: "cline",
    },
    {
      id: "amazon-q",
      displayName: "Amazon Q Developer (legacy MCP)",
      scope: "project",
      format: "mcpServers",
      label: ".amazonq/mcp.json (Amazon Q legacy MCP)",
      pathSegments: [".amazonq", "mcp.json"],
      docsUrl:
        "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html",
      defaultOnMcp: true,
      integrationTarget: "amazon-q",
    },
    {
      id: "amazon-q-default",
      displayName: "Amazon Q Developer (IDE)",
      scope: "project",
      format: "amazon-q-ide",
      label: ".amazonq/default.json (Amazon Q IDE)",
      pathSegments: [".amazonq", "default.json"],
      docsUrl:
        "https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html",
      defaultOnMcp: true,
      integrationTarget: "amazon-q",
    },
    {
      id: "gemini",
      displayName: "Gemini CLI",
      scope: "project",
      format: "mcpServers",
      label: ".gemini/settings.json (Gemini CLI)",
      pathSegments: [".gemini", "settings.json"],
      docsUrl:
        "https://github.com/google-gemini/gemini-cli/blob/HEAD/docs/tools/mcp-server.md",
      defaultOnMcp: true,
      integrationTarget: "gemini-md",
    },
    {
      id: "windsurf",
      displayName: "Windsurf (Cascade)",
      scope: "user-global",
      format: "mcpServers",
      label: "~/.codeium/windsurf/mcp_config.json (Windsurf Cascade)",
      pathSegments: [".codeium", "windsurf", "mcp_config.json"],
      docsUrl: "https://docs.windsurf.com/windsurf/cascade/mcp",
      defaultOnMcp: false,
      integrationTarget: "windsurf",
      postWriteNote:
        "Windsurf MCP is user-global per official docs; restart Cascade after changes.",
    },
  ]);

const REGISTRY_BY_ID = new Map(
  AGENTS_INIT_MCP_REGISTRY.map((def) => [def.id, def]),
);

const INTEGRATION_TO_MCP = new Map<AgentsInitTarget, AgentsInitMcpTarget[]>(
  AGENTS_INIT_MCP_REGISTRY.reduce((acc, def) => {
    if (def.integrationTarget === undefined) {
      return acc;
    }
    const list = acc.get(def.integrationTarget) ?? [];
    if (!list.includes(def.id)) {
      list.push(def.id);
    }
    acc.set(def.integrationTarget, list);
    return acc;
  }, new Map<AgentsInitTarget, AgentsInitMcpTarget[]>()),
);

/** Project-local MCP targets written by default when `--mcp` has no integration filter. */
export const DEFAULT_AGENTS_INIT_MCP_TARGETS: readonly AgentsInitMcpTarget[] =
  Object.freeze(
    AGENTS_INIT_MCP_REGISTRY.filter((def) => def.defaultOnMcp).map(
      (def) => def.id,
    ),
  );

export function getAgentsInitMcpTargetDef(
  id: AgentsInitMcpTarget,
): AgentsInitMcpTargetDef {
  const def = REGISTRY_BY_ID.get(id);
  if (def === undefined) {
    throw new Error(`Codemap: unknown MCP target id ${JSON.stringify(id)}`);
  }
  return def;
}

export function resolveMcpConfigPath(
  def: AgentsInitMcpTargetDef,
  roots: { projectRoot: string; homeDir: string },
): string {
  const base = def.scope === "user-global" ? roots.homeDir : roots.projectRoot;
  return join(base, ...def.pathSegments);
}

/**
 * Map `agents init` integration picks to MCP writers. When integrations are
 * omitted (non-interactive `--mcp`), all `defaultOnMcp` registry entries apply.
 * An empty array means the user selected no integrations — write nothing.
 */
export function resolveAgentsInitMcpTargets(
  agentsTargets?: AgentsInitTarget[] | undefined,
): AgentsInitMcpTarget[] {
  if (agentsTargets === undefined) {
    return [...DEFAULT_AGENTS_INIT_MCP_TARGETS];
  }
  const out: AgentsInitMcpTarget[] = [];
  for (const t of agentsTargets) {
    const mcps = INTEGRATION_TO_MCP.get(t);
    if (mcps === undefined) {
      continue;
    }
    for (const mcp of mcps) {
      if (!out.includes(mcp)) {
        out.push(mcp);
      }
    }
  }
  return out;
}

/** Count of registry entries with `defaultOnMcp` — useful for docs/tests drift checks. */
export function countDefaultMcpTargets(): number {
  return AGENTS_INIT_MCP_REGISTRY.filter((def) => def.defaultOnMcp).length;
}
