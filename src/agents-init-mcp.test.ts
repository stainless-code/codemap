import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODEMAP_MCP_PERMISSION_ALLOW,
  CODEMAP_MCP_SERVER_KEY,
  applyAgentsInitMcp,
  buildCodemapMcpServerEntry,
  mergeClaudeCodemapPermissions,
  mergeCodemapMcpServer,
} from "./agents-init-mcp";

describe("buildCodemapMcpServerEntry", () => {
  it("includes workspace root for Cursor", () => {
    expect(buildCodemapMcpServerEntry({ includeWorkspaceRoot: true })).toEqual({
      command: "codemap",
      args: ["mcp", "--watch", "--root", "${workspaceFolder}"],
    });
  });

  it("omits --root for cwd-based clients", () => {
    expect(buildCodemapMcpServerEntry()).toEqual({
      command: "codemap",
      args: ["mcp", "--watch"],
    });
  });
});

describe("mergeCodemapMcpServer", () => {
  it("preserves foreign MCP servers", () => {
    const merged = mergeCodemapMcpServer(
      {
        mcpServers: {
          other: { command: "npx", args: ["-y", "other-mcp"] },
        },
      },
      buildCodemapMcpServerEntry({ includeWorkspaceRoot: true }),
    );
    expect(Object.keys(merged.mcpServers ?? {})).toEqual(["other", "codemap"]);
    expect(merged.mcpServers?.other?.command).toBe("npx");
    expect(merged.mcpServers?.[CODEMAP_MCP_SERVER_KEY]?.args).toContain(
      "${workspaceFolder}",
    );
  });
});

describe("mergeClaudeCodemapPermissions", () => {
  it("appends codemap allow without duplicating", () => {
    const once = mergeClaudeCodemapPermissions({
      permissions: { allow: ["Bash(git *)"] },
    });
    expect(once.permissions?.allow).toContain(CODEMAP_MCP_PERMISSION_ALLOW);

    const twice = mergeClaudeCodemapPermissions(once);
    expect(
      twice.permissions?.allow?.filter(
        (x) => x === CODEMAP_MCP_PERMISSION_ALLOW,
      ),
    ).toHaveLength(1);
  });
});

describe("applyAgentsInitMcp", () => {
  it("writes Cursor and Claude project MCP files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      applyAgentsInitMcp({ projectRoot: dir });
      const cursor = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      ) as { mcpServers: Record<string, { args: string[] }> };
      expect(cursor.mcpServers[CODEMAP_MCP_SERVER_KEY]?.args).toContain(
        "${workspaceFolder}",
      );

      const claudeMcp = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8"),
      ) as { mcpServers: Record<string, { args: string[] }> };
      expect(claudeMcp.mcpServers[CODEMAP_MCP_SERVER_KEY]?.args).toEqual([
        "mcp",
        "--watch",
      ]);

      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      ) as { permissions: { allow: string[] } };
      expect(settings.permissions.allow).toContain(
        CODEMAP_MCP_PERMISSION_ALLOW,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges into existing .cursor/mcp.json without clobbering other servers", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              foreign: { command: "node", args: ["server.js"] },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] });
      const parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      ) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers.foreign).toEqual({
        command: "node",
        args: ["server.js"],
      });
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent on re-run", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] });
      const before = readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8");
      applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] });
      expect(readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8")).toBe(
        before,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid JSON without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(join(dir, ".cursor", "mcp.json"), "{ not json", "utf-8");
      expect(() =>
        applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] }),
      ).toThrow(/could not parse/);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
