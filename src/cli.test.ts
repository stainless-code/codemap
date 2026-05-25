import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  test("agents init --force --mcp writes .cursor/mcp.json under --root", async () => {
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
      expect(parsed.mcpServers.codemap?.command).toBe("codemap");
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
