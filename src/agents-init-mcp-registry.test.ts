import { describe, expect, it } from "bun:test";

import { countDefaultMcpTargets } from "./agents-init-mcp-registry";
import {
  AGENTS_INIT_MCP_REGISTRY,
  DEFAULT_AGENTS_INIT_MCP_TARGETS,
  getAgentsInitMcpTargetDef,
  resolveAgentsInitMcpTargets,
  resolveMcpConfigPath,
} from "./agents-init-mcp-registry";

describe("AGENTS_INIT_MCP_REGISTRY", () => {
  it("has unique ids and integration targets", () => {
    const ids = AGENTS_INIT_MCP_REGISTRY.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);

    const integrations = AGENTS_INIT_MCP_REGISTRY.flatMap((def) =>
      def.integrationTarget !== undefined ? [def.integrationTarget] : [],
    );
    expect(new Set(integrations).size).toBe(integrations.length);
  });

  it("default targets match registry defaultOnMcp flags", () => {
    expect(DEFAULT_AGENTS_INIT_MCP_TARGETS).toEqual(
      AGENTS_INIT_MCP_REGISTRY.filter((def) => def.defaultOnMcp).map(
        (def) => def.id,
      ),
    );
    expect(DEFAULT_AGENTS_INIT_MCP_TARGETS).not.toContain("windsurf");
    expect(countDefaultMcpTargets()).toBe(
      DEFAULT_AGENTS_INIT_MCP_TARGETS.length,
    );
  });

  it("resolveMcpConfigPath uses project root or home by scope", () => {
    const cursor = getAgentsInitMcpTargetDef("cursor");
    const windsurf = getAgentsInitMcpTargetDef("windsurf");
    expect(
      resolveMcpConfigPath(cursor, {
        projectRoot: "/proj",
        homeDir: "/home/u",
      }),
    ).toBe("/proj/.cursor/mcp.json");
    expect(
      resolveMcpConfigPath(windsurf, {
        projectRoot: "/proj",
        homeDir: "/home/u",
      }),
    ).toBe("/home/u/.codeium/windsurf/mcp_config.json");
  });

  it("resolveAgentsInitMcpTargets maps integration picks", () => {
    expect(resolveAgentsInitMcpTargets(undefined)).toEqual([
      "cursor",
      "claude-code",
      "vscode",
      "continue",
      "cline",
      "amazon-q",
      "gemini",
    ]);
    expect(resolveAgentsInitMcpTargets([])).toEqual([]);
    expect(resolveAgentsInitMcpTargets(["cursor", "copilot"])).toEqual([
      "cursor",
      "vscode",
    ]);
    expect(resolveAgentsInitMcpTargets(["windsurf"])).toEqual(["windsurf"]);
    expect(resolveAgentsInitMcpTargets(["agents-md"])).toEqual([]);
  });
});
