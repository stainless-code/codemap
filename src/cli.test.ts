import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isCodemapHookInstalled } from "./application/git-hooks";
import { parseBootstrapArgs, validateIndexModeArgs } from "./cli";
import { CODEMAP_VERSION } from "./version";

describe("parseBootstrapArgs", () => {
  test("passes --help through in rest after --root", () => {
    const { root, rest } = parseBootstrapArgs(["--root", "/tmp/foo", "--help"]);
    expect(root).toBe("/tmp/foo");
    expect(rest).toEqual(["--help"]);
  });
});

async function runCli(
  args: string[],
): Promise<{ exitCode: number; out: string; err: string }> {
  const indexTs = join(import.meta.dir, "index.ts");
  const proc = Bun.spawn([Bun.which("bun")!, indexTs, ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

describe("CLI --help", () => {
  test("exits 0 and prints usage without touching the database", async () => {
    const { exitCode, out, err } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("Usage:");
    expect(out).toContain("codemap query");
    expect(err).toBe("");
  });

  test("query --help exits 0 and documents --json + --summary + --group-by", async () => {
    const { exitCode, out, err } = await runCli(["query", "--help"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("--json");
    expect(out).toContain("--summary");
    expect(out).toContain("--changed-since");
    expect(out).toContain("--group-by");
    expect(out).toContain("--recipe");
    expect(out).toContain("fan-out");
    expect(out).toContain("codemap query");
    expect(out).toContain("LIMIT");
    expect(err).toBe("");
  });

  test("audit --help exits 0 and documents the v1 surface", async () => {
    const { exitCode, out, err } = await runCli(["audit", "--help"]);
    expect(exitCode).toBe(0);
    expect(out).toContain("codemap audit");
    expect(out).toContain("--baseline <prefix>");
    expect(out).toContain("--files-baseline <name>");
    expect(out).toContain("--dependencies-baseline <name>");
    expect(out).toContain("--deprecated-baseline <name>");
    expect(out).toContain("--no-index");
    expect(out).toContain("--summary");
    expect(out).toContain("query_baselines");
    expect(err).toBe("");
  });

  test("audit with no flags exits 1 and points at the snapshot sources", async () => {
    const { exitCode, err } = await runCli(["audit"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("missing snapshot source");
    expect(err).toContain("--baseline");
  });

  test("query with no SQL exits 1", async () => {
    const { exitCode, err } = await runCli(["query"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("missing SQL");
  });
});

describe("CLI version", () => {
  test.each(["version", "--version", "-V"])(
    "%s prints version and exits 0",
    async (flag) => {
      const { exitCode, out, err } = await runCli([flag]);
      expect(exitCode).toBe(0);
      expect(out.trim()).toBe(CODEMAP_VERSION);
      expect(err).toBe("");
    },
  );
});

describe("validateIndexModeArgs", () => {
  test("allows empty, --full, and --files with paths", () => {
    expect(() => validateIndexModeArgs([])).not.toThrow();
    expect(() => validateIndexModeArgs(["--full"])).not.toThrow();
    expect(() =>
      validateIndexModeArgs(["--files", "a.ts", "b.tsx"]),
    ).not.toThrow();
  });
});

describe("CLI unknown / invalid args", () => {
  test("typo --versiond exits 1 before DB (stderr)", async () => {
    const { exitCode, out, err } = await runCli(["--versiond"]);
    expect(exitCode).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("unknown option");
    expect(err).toContain("--versiond");
  });

  test("bare subcommand typo exits 1", async () => {
    const { exitCode, err } = await runCli(["notacommand"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("unexpected argument");
  });

  test("agents init rejects positional argument (use --interactive)", async () => {
    const { exitCode, err } = await runCli(["agents", "init", "interactive"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("unexpected argument");
    expect(err).toContain("interactive");
  });

  test("agents init -i rejects --git-hooks combination", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-i-hooks-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "-i",
        "--git-hooks",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("cannot be combined with --interactive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --force --mcp writes project MCP configs under --root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-mcp-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      const parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      ) as { mcpServers: Record<string, { command: string }> };
      expect(parsed.mcpServers.codemap?.command).toBe("npx");
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(true);
      const vscode = JSON.parse(
        readFileSync(join(dir, ".vscode", "mcp.json"), "utf-8"),
      ) as { servers: Record<string, { args: string[] }> };
      expect(vscode.servers.codemap?.args).toContain("--root");
      expect(vscode.servers.codemap?.args).toContain("${workspaceFolder}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --mcp exits 1 with message on unparseable MCP JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-mcp-bad-"));
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      writeFileSync(join(dir, ".cursor", "mcp.json"), "{ not json", "utf-8");
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--mcp",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toMatch(/could not parse|Codemap:/);
      expect(err).not.toMatch(/at upsertMcpServersFile/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --mcp on existing .agents/ writes MCP only (CLI subprocess)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-mcp-only-"));
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      writeFileSync(join(dir, ".agents", "USER.md"), "keep", "utf-8");
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(readFileSync(join(dir, ".agents", "USER.md"), "utf-8")).toBe(
        "keep",
      );
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --git-hooks on existing .agents/ installs hooks only (CLI subprocess)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-hooks-"));
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(dir, ".agents", "USER.md"), "keep", "utf-8");
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--git-hooks",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(readFileSync(join(dir, ".agents", "USER.md"), "utf-8")).toBe(
        "keep",
      );
      expect(
        isCodemapHookInstalled(join(dir, ".git", "hooks", "post-commit")),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets cursor --mcp writes Cursor MCP and rules only", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-cursor-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--targets",
        "cursor",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".cursor", "rules"))).toBe(true);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
      expect(existsSync(join(dir, ".continue"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets cursor,copilot --mcp writes Cursor and VS Code MCP only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-targets-cc-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--targets",
        "cursor,copilot",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".continue"))).toBe(false);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets cursor --interactive exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-targets-i-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--targets",
        "cursor",
        "--interactive",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("cannot be combined with --interactive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets nope exits 1 with valid ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-targets-bad-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--targets",
        "nope",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("unknown integration");
      expect(err).toContain("cursor");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets windsurf --link-mode copy uses copies not symlinks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-targets-ws-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--targets",
        "windsurf",
        "--link-mode",
        "copy",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      const rulePath = join(dir, ".windsurf", "rules", "codemap.md");
      expect(existsSync(rulePath)).toBe(true);
      expect(lstatSync(rulePath).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets copilot --link-mode copy exits 1", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-lm-copilot-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--targets",
        "copilot",
        "--link-mode",
        "copy",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("--link-mode is only valid");
      expect(err).toContain("copilot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --link-mode symlink without --targets exits 1", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-lm-alone-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--link-mode",
        "symlink",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("--link-mode is only valid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets without value exits 1", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-empty-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--targets",
      ]);
      expect(exitCode).toBe(1);
      expect(err).toContain("--targets requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets cursor without --mcp wires rules only", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-no-mcp-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--targets",
        "cursor",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".cursor", "rules"))).toBe(true);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets claude-md --mcp writes root .mcp.json only", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-claude-"),
    );
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--targets",
        "claude-md",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --force --mcp still writes full default MCP set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-mcp-defaults-"));
    try {
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--force",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
      expect(
        existsSync(join(dir, ".continue", "mcpServers", "codemap-mcp.json")),
      ).toBe(true);
      expect(existsSync(join(dir, ".cline", "mcp.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --targets copilot on existing .agents/ writes copilot instructions only", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-targets-copilot-"),
    );
    try {
      mkdirSync(join(dir, ".agents", "rules"), { recursive: true });
      mkdirSync(join(dir, ".agents", "skills", "codemap"), {
        recursive: true,
      });
      writeFileSync(join(dir, ".agents", "USER.md"), "keep", "utf-8");
      writeFileSync(
        join(dir, ".agents", "rules", "codemap.md"),
        "<!-- codemap-init:managed -->\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".agents", "skills", "codemap", "SKILL.md"),
        "<!-- codemap-init:managed -->\n",
        "utf-8",
      );
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--targets",
        "copilot",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(readFileSync(join(dir, ".agents", "USER.md"), "utf-8")).toBe(
        "keep",
      );
      expect(
        readFileSync(join(dir, ".github", "copilot-instructions.md"), "utf-8"),
      ).toContain("Codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --git-hooks --targets cursor on existing .agents/ composes", async () => {
    const dir = mkdtempSync(
      join(tmpdir(), "codemap-cli-agents-hooks-targets-"),
    );
    try {
      mkdirSync(join(dir, ".agents", "rules"), { recursive: true });
      mkdirSync(join(dir, ".agents", "skills", "codemap"), {
        recursive: true,
      });
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(
        join(dir, ".agents", "rules", "codemap.md"),
        "<!-- codemap-init:managed -->\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".agents", "skills", "codemap", "SKILL.md"),
        "<!-- codemap-init:managed -->\n",
        "utf-8",
      );
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--git-hooks",
        "--targets",
        "cursor",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(
        isCodemapHookInstalled(join(dir, ".git", "hooks", "post-commit")),
      ).toBe(true);
      expect(existsSync(join(dir, ".cursor", "rules", "codemap.mdc"))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("agents init --git-hooks --mcp on existing .agents/ composes side effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-cli-agents-combo-"));
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(dir, ".agents", "USER.md"), "keep", "utf-8");
      const { exitCode, err } = await runCli([
        "--root",
        dir,
        "agents",
        "init",
        "--git-hooks",
        "--mcp",
      ]);
      expect(exitCode).toBe(0);
      expect(err).toBe("");
      expect(
        isCodemapHookInstalled(join(dir, ".git", "hooks", "post-commit")),
      ).toBe(true);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--files without paths exits 1 before DB", async () => {
    const { exitCode, err } = await runCli(["--files"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("--files requires at least one path");
  });

  test("--files with only a following flag exits 1", async () => {
    const { exitCode, err } = await runCli(["--files", "--full"]);
    expect(exitCode).toBe(1);
    expect(err).toMatch(
      /--files requires at least one path|unexpected option "--full" after --files/,
    );
  });

  test("--files after --full exits 1", async () => {
    const { exitCode, err } = await runCli(["--full", "--files", "src/x.ts"]);
    expect(exitCode).toBe(1);
    expect(err).toContain("--files must be the first index option");
  });
});
