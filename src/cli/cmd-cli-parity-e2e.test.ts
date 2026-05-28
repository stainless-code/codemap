import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  readResource,
  unknownFileResourceError,
} from "../application/resource-handlers";
import { resolveCodemapConfig } from "../config";
import { initCodemap } from "../runtime";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
const minimalRoot = join(repoRoot, "fixtures", "minimal");
let bunBin: string | null = null;

async function runCli(
  args: string[],
  opts: {
    env?: Record<string, string>;
    stdin?: string;
  } = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  if (bunBin === null) {
    throw new Error(
      "cmd-cli-parity-e2e.test: bunBin not initialised by beforeAll.",
    );
  }
  const proc = Bun.spawn([bunBin, indexTs, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    env: { ...process.env, ...opts.env },
  });
  if (opts.stdin !== undefined) {
    const stdin = proc.stdin;
    if (stdin === undefined) {
      throw new Error(
        "cmd-cli-parity-e2e.test: expected pipe stdin on spawned process.",
      );
    }
    stdin.write(opts.stdin);
    stdin.end();
  }
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

beforeAll(async () => {
  bunBin = Bun.which("bun");
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-cli-parity-e2e.test: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
  const idx = await runCli(["--full"], { env: { CODEMAP_ROOT: minimalRoot } });
  expect(idx.exitCode).toBe(0);
}, 120_000);

describe("CLI parity e2e — fixtures/minimal", () => {
  it("query batch --stdin returns statement results", async () => {
    const r = await runCli(["query", "batch", "--stdin", "--compact"], {
      env: { CODEMAP_ROOT: minimalRoot },
      stdin: '{"statements":["SELECT COUNT(*) AS n FROM files"]}',
    });
    expect(r.exitCode).toBe(0);
    expect(r.err).toBe("");
    const batch = JSON.parse(r.out) as Array<Array<{ n: number }>>;
    expect(Array.isArray(batch)).toBe(true);
    expect(batch[0]?.[0]?.n).toBeGreaterThan(0);
  });

  it("file returns the same JSON as codemap://files/{path}", async () => {
    const path = "src/utils/format.ts";
    const r = await runCli(["file", path, "--compact"], {
      env: { CODEMAP_ROOT: minimalRoot },
    });
    expect(r.exitCode).toBe(0);
    initCodemap(resolveCodemapConfig(minimalRoot, undefined));
    const fromCli = JSON.parse(r.out) as { path: string };
    const fromResource = JSON.parse(
      readResource(`codemap://files/${path}`)!.text,
    ) as { path: string };
    expect(fromCli).toEqual(fromResource);
    expect(fromCli.path).toBe(path);
  });

  it("file not indexed uses MCP-aligned error text", async () => {
    const path = "no/such.ts";
    const r = await runCli(["file", path, "--compact"], {
      env: { CODEMAP_ROOT: minimalRoot },
    });
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.out)).toEqual({
      error: unknownFileResourceError(path),
    });
  });

  it("symbols returns the same JSON as codemap://symbols/{name}", async () => {
    const r = await runCli(["symbols", "usePermissions", "--compact"], {
      env: { CODEMAP_ROOT: minimalRoot },
    });
    expect(r.exitCode).toBe(0);
    initCodemap(resolveCodemapConfig(minimalRoot, undefined));
    const fromCli = JSON.parse(r.out) as { matches: unknown[] };
    const fromResource = JSON.parse(
      readResource("codemap://symbols/usePermissions")!.text,
    ) as { matches: unknown[] };
    expect(fromCli).toEqual(fromResource);
    expect(fromCli.matches.length).toBeGreaterThan(0);
  });

  it("trace wires handler and returns JSON envelope", async () => {
    const r = await runCli(
      [
        "trace",
        "--from",
        "epochMs",
        "--to",
        "nowIso",
        "--via",
        "calls",
        "--compact",
      ],
      { env: { CODEMAP_ROOT: minimalRoot } },
    );
    expect(r.err).toBe("");
    const payload = JSON.parse(r.out) as Record<string, unknown>;
    expect(payload.path !== undefined || payload.error !== undefined).toBe(
      true,
    );
  });
});
