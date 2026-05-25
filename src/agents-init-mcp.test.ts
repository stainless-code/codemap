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
  buildMcpServerEntryForDef,
  mergeClaudeCodemapPermissions,
  mergeCodemapMcpServer,
  mergeCodemapVsCodeServer,
  normalizeExistingMcpServersFile,
  normalizeExistingVsCodeMcpFile,
  verifyCodemapMcpServersFile,
} from "./agents-init-mcp";
import { getAgentsInitMcpTargetDef } from "./agents-init-mcp-registry";

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

  it("adds Amazon Q IDE transport fields for default.json", () => {
    expect(
      buildMcpServerEntryForDef(getAgentsInitMcpTargetDef("amazon-q-default")),
    ).toEqual({
      command: "codemap",
      args: ["mcp", "--watch"],
      transportType: "stdio",
      disabled: false,
      timeout: 60,
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

  it("adds codemap to empty mcpServers", () => {
    const merged = mergeCodemapMcpServer(
      { mcpServers: {} },
      buildCodemapMcpServerEntry(),
    );
    expect(Object.keys(merged.mcpServers ?? {})).toEqual(["codemap"]);
  });

  it("adds codemap when mcpServers key is missing", () => {
    const merged = mergeCodemapMcpServer({}, buildCodemapMcpServerEntry());
    expect(Object.keys(merged.mcpServers ?? {})).toEqual(["codemap"]);
  });
});

describe("normalizeExistingMcpServersFile", () => {
  it("rejects non-object mcpServers without force", () => {
    expect(() =>
      normalizeExistingMcpServersFile(
        { mcpServers: "not-an-object" },
        { label: ".cursor/mcp.json", force: false },
      ),
    ).toThrow(/mcpServers must be a JSON object/);
  });

  it("replaces non-object mcpServers with force", () => {
    expect(
      normalizeExistingMcpServersFile(
        { mcpServers: ["a", "b"] },
        { label: ".mcp.json", force: true },
      ),
    ).toEqual({
      existing: {},
      replacedInvalid: true,
      invalidReason: "shape",
    });
  });

  it("preserves non-mcpServers keys when force-replacing invalid mcpServers", () => {
    expect(
      normalizeExistingMcpServersFile(
        { mcpServers: "bad", editor: "cursor" },
        { label: ".cursor/mcp.json", force: true },
      ),
    ).toEqual({
      existing: { editor: "cursor" },
      replacedInvalid: true,
      invalidReason: "shape",
    });
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

  it("coerces non-array permissions.allow to empty before append", () => {
    const merged = mergeClaudeCodemapPermissions({
      permissions: { allow: "not-an-array" as unknown as string[] },
    });
    expect(merged.permissions?.allow).toEqual([CODEMAP_MCP_PERMISSION_ALLOW]);
  });
});

describe("mergeCodemapVsCodeServer", () => {
  it("preserves foreign servers and sets stdio type", () => {
    const merged = mergeCodemapVsCodeServer(
      {
        servers: {
          other: { command: "npx", args: ["-y", "other"] },
        },
      },
      buildCodemapMcpServerEntry(),
    );
    expect(merged.servers?.other?.command).toBe("npx");
    expect(merged.servers?.[CODEMAP_MCP_SERVER_KEY]).toEqual({
      type: "stdio",
      command: "codemap",
      args: ["mcp", "--watch"],
    });
  });
});

describe("normalizeExistingVsCodeMcpFile", () => {
  it("rejects non-object servers without force", () => {
    expect(() =>
      normalizeExistingVsCodeMcpFile(
        { servers: "bad" },
        { label: ".vscode/mcp.json", force: false },
      ),
    ).toThrow(/servers must be a JSON object/);
  });
});

describe("verifyCodemapMcpServersFile", () => {
  it("throws when codemap entry is missing after write", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-verify-"));
    const path = join(dir, "mcp.json");
    try {
      writeFileSync(
        path,
        `${JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }, null, 2)}\n`,
        "utf-8",
      );
      expect(() =>
        verifyCodemapMcpServersFile({
          path,
          label: "test mcp.json",
          expectedEntry: buildCodemapMcpServerEntry(),
        }),
      ).toThrow(/missing codemap entry/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyAgentsInitMcp", () => {
  it("writes all default project MCP files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-all-"));
    const fakeHome = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-home-"));
    try {
      applyAgentsInitMcp({ projectRoot: dir, homeDir: fakeHome });
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(true);
      expect(
        existsSync(join(dir, ".continue", "mcpServers", "codemap-mcp.json")),
      ).toBe(true);
      expect(existsSync(join(dir, ".amazonq", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".amazonq", "default.json"))).toBe(true);
      expect(existsSync(join(dir, ".gemini", "settings.json"))).toBe(true);
      expect(existsSync(join(dir, ".cline", "mcp.json"))).toBe(true);
      expect(existsSync(join(fakeHome, ".cline", "mcp.json"))).toBe(false);

      const vscode = JSON.parse(
        readFileSync(join(dir, ".vscode", "mcp.json"), "utf-8"),
      ) as { servers: Record<string, { type: string; command: string }> };
      expect(vscode.servers[CODEMAP_MCP_SERVER_KEY]?.type).toBe("stdio");
      expect(vscode.servers[CODEMAP_MCP_SERVER_KEY]?.command).toBe("codemap");

      const amazonDefault = JSON.parse(
        readFileSync(join(dir, ".amazonq", "default.json"), "utf-8"),
      ) as {
        mcpServers: Record<
          string,
          {
            command: string;
            args?: string[];
            transportType?: string;
            disabled?: boolean;
            timeout?: number;
          }
        >;
      };
      expect(amazonDefault.mcpServers[CODEMAP_MCP_SERVER_KEY]).toEqual({
        command: "codemap",
        args: ["mcp", "--watch"],
        transportType: "stdio",
        disabled: false,
        timeout: 60,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("writes project .cline/mcp.json when cline target selected", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-cl-"));
    const fakeHome = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-cl-home-"));
    try {
      applyAgentsInitMcp({
        projectRoot: dir,
        homeDir: fakeHome,
        targets: ["cline"],
      });
      expect(existsSync(join(dir, ".cline", "mcp.json"))).toBe(true);
      expect(existsSync(join(fakeHome, ".cline", "mcp.json"))).toBe(false);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("writes Windsurf global config only when windsurf target selected", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-ws-"));
    const fakeHome = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-ws-home-"));
    try {
      applyAgentsInitMcp({
        projectRoot: dir,
        homeDir: fakeHome,
        targets: ["windsurf"],
      });
      expect(
        existsSync(join(fakeHome, ".codeium", "windsurf", "mcp_config.json")),
      ).toBe(true);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

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

  it("rejects non-object mcpServers without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        `${JSON.stringify({ mcpServers: "bad" }, null, 2)}\n`,
        "utf-8",
      );
      expect(() =>
        applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] }),
      ).toThrow(/mcpServers must be a JSON object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("force-replaces invalid mcpServers shape and preserves other keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    const stderr: string[] = [];
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      stderr.push(
        args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
      prevError(...args);
    };
    try {
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        `${JSON.stringify({ mcpServers: "bad", editor: "cursor" }, null, 2)}\n`,
        "utf-8",
      );
      applyAgentsInitMcp({
        projectRoot: dir,
        targets: ["cursor"],
        force: true,
      });
      const parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      ) as {
        editor: string;
        mcpServers: Record<string, { command: string }>;
      };
      expect(parsed.editor).toBe("cursor");
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]?.command).toBe(
        "codemap",
      );
      expect(
        stderr.some((line) => line.includes("invalid mcpServers shape")),
      ).toBe(true);
    } finally {
      console.error = prevError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces invalid JSON with --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    const stderr: string[] = [];
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      stderr.push(
        args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
      prevError(...args);
    };
    try {
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(join(dir, ".cursor", "mcp.json"), "{ not json", "utf-8");
      applyAgentsInitMcp({
        projectRoot: dir,
        targets: ["cursor"],
        force: true,
      });
      const parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      ) as { mcpServers: Record<string, { command: string }> };
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]?.command).toBe(
        "codemap",
      );
      expect(stderr.some((line) => line.includes("unparseable JSON"))).toBe(
        true,
      );
    } finally {
      console.error = prevError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces invalid Claude .mcp.json with --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    const stderr: string[] = [];
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      stderr.push(
        args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
      prevError(...args);
    };
    try {
      writeFileSync(join(dir, ".mcp.json"), "{ not json", "utf-8");
      applyAgentsInitMcp({
        projectRoot: dir,
        targets: ["claude-code"],
        force: true,
      });
      const parsed = JSON.parse(
        readFileSync(join(dir, ".mcp.json"), "utf-8"),
      ) as {
        mcpServers: Record<string, { command: string }>;
      };
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]?.command).toBe(
        "codemap",
      );
      expect(
        stderr.some((line) => line.includes(".mcp.json (Claude Code)")),
      ).toBe(true);
    } finally {
      console.error = prevError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces invalid .claude/settings.json with --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    const stderr: string[] = [];
    const prevError = console.error;
    console.error = (...args: unknown[]) => {
      stderr.push(
        args.map((a) => (typeof a === "string" ? a : String(a))).join(" "),
      );
      prevError(...args);
    };
    try {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "settings.json"),
        "{ not json",
        "utf-8",
      );
      applyAgentsInitMcp({
        projectRoot: dir,
        targets: ["claude-code"],
        force: true,
      });
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      ) as { permissions: { allow: string[] } };
      expect(settings.permissions.allow).toContain(
        CODEMAP_MCP_PERMISSION_ALLOW,
      );
      expect(
        stderr.some((line) => line.includes(".claude/settings.json")),
      ).toBe(true);
    } finally {
      console.error = prevError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges Claude files without clobbering foreign servers or permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      writeFileSync(
        join(dir, ".mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              foreign: { command: "node", args: ["other.js"] },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "settings.json"),
        `${JSON.stringify(
          {
            permissions: {
              allow: ["Bash(git *)"],
              deny: ["WebFetch"],
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      applyAgentsInitMcp({ projectRoot: dir, targets: ["claude-code"] });
      const mcp = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf-8")) as {
        mcpServers: Record<string, unknown>;
      };
      expect(mcp.mcpServers.foreign).toEqual({
        command: "node",
        args: ["other.js"],
      });
      expect(mcp.mcpServers[CODEMAP_MCP_SERVER_KEY]).toBeDefined();

      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.json"), "utf-8"),
      ) as { permissions: { allow: string[]; deny: string[] } };
      expect(settings.permissions.allow).toContain("Bash(git *)");
      expect(settings.permissions.allow).toContain(
        CODEMAP_MCP_PERMISSION_ALLOW,
      );
      expect(settings.permissions.deny).toEqual(["WebFetch"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed permissions.allow without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-"));
    try {
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        join(dir, ".claude", "settings.json"),
        `${JSON.stringify({ permissions: { allow: "bad" } }, null, 2)}\n`,
        "utf-8",
      );
      expect(() =>
        applyAgentsInitMcp({ projectRoot: dir, targets: ["claude-code"] }),
      ).toThrow(/permissions\.allow must be a string\[\]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges Amazon Q default.json without clobbering foreign keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-mcp-q-"));
    try {
      mkdirSync(join(dir, ".amazonq"), { recursive: true });
      writeFileSync(
        join(dir, ".amazonq", "default.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              foreign: {
                command: "node",
                args: ["other.js"],
                transportType: "stdio",
              },
            },
            someAgentSetting: true,
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      applyAgentsInitMcp({
        projectRoot: dir,
        targets: ["amazon-q-default"],
      });
      const parsed = JSON.parse(
        readFileSync(join(dir, ".amazonq", "default.json"), "utf-8"),
      ) as {
        mcpServers: Record<string, unknown>;
        someAgentSetting?: boolean;
      };
      expect(parsed.someAgentSetting).toBe(true);
      expect(parsed.mcpServers.foreign).toEqual({
        command: "node",
        args: ["other.js"],
        transportType: "stdio",
      });
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]).toMatchObject({
        command: "codemap",
        transportType: "stdio",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
