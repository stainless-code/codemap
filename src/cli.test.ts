import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseBootstrapArgs } from "./cli";

describe("parseBootstrapArgs", () => {
  test("passes --help through in rest after --root", () => {
    const { root, rest } = parseBootstrapArgs(["--root", "/tmp/foo", "--help"]);
    expect(root).toBe("/tmp/foo");
    expect(rest).toEqual(["--help"]);
  });
});

describe("CLI --help", () => {
  test("exits 0 and prints usage without touching the database", async () => {
    const indexTs = join(import.meta.dir, "index.ts");
    const proc = Bun.spawn([Bun.which("bun")!, indexTs, "--help"], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(exitCode).toBe(0);
    expect(out).toContain("Usage:");
    expect(out).toContain("codemap query");
    expect(err).toBe("");
  });
});
