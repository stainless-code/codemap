import { describe, expect, test } from "bun:test";
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
  test("allows empty, --full, --files paths, and combinations", () => {
    expect(() => validateIndexModeArgs([])).not.toThrow();
    expect(() => validateIndexModeArgs(["--full"])).not.toThrow();
    expect(() =>
      validateIndexModeArgs(["--files", "a.ts", "b.tsx"]),
    ).not.toThrow();
    expect(() =>
      validateIndexModeArgs(["--full", "--files", "src/x.ts"]),
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
});
