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
  it("cursor and vscode inject workspace root via registry flag", () => {
    expect(getAgentsInitMcpTargetDef("cursor").workspaceRootArg).toBe(true);
    expect(getAgentsInitMcpTargetDef("vscode").workspaceRootArg).toBe(true);
    expect(
      getAgentsInitMcpTargetDef("claude-code").workspaceRootArg,
    ).toBeUndefined();
  });

  it("has unique ids", () => {
    const ids = AGENTS_INIT_MCP_REGISTRY.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("allows multiple MCP writers per integration target", () => {
    const amazonQ = AGENTS_INIT_MCP_REGISTRY.filter(
      (def) => def.integrationTarget === "amazon-q",
    );
    expect(amazonQ.map((def) => def.id)).toEqual([
      "amazon-q",
      "amazon-q-default",
    ]);
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
      "amazon-q-default",
      "gemini",
    ]);
    expect(resolveAgentsInitMcpTargets([])).toEqual([]);
    expect(resolveAgentsInitMcpTargets(["cursor", "copilot"])).toEqual([
      "cursor",
      "vscode",
    ]);
    expect(resolveAgentsInitMcpTargets(["amazon-q"])).toEqual([
      "amazon-q",
      "amazon-q-default",
    ]);
    expect(resolveAgentsInitMcpTargets(["windsurf"])).toEqual(["windsurf"]);
    expect(resolveAgentsInitMcpTargets(["agents-md"])).toEqual([]);
  });
});
