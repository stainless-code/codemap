/**
 * Phase 3 in-repo test bench: spawn CLI against fixtures/minimal after one index.
 * Complements cmd-cli-parity-e2e (resources, batch, trace) with show/snippet/impact/validate/SARIF.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
const benchRoot = join(repoRoot, "fixtures", "minimal");
let bunBin: string | null = null;

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  if (bunBin === null) {
    throw new Error(
      "cmd-test-bench-e2e.test: bunBin not initialised by beforeAll.",
    );
  }
  const proc = Bun.spawn([bunBin, indexTs, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CODEMAP_ROOT: benchRoot, ...env },
  });
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

beforeAll(async () => {
  bunBin = Bun.which("bun");
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-test-bench-e2e.test: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
  const idx = await runCli(["--full"]);
  expect(idx.exitCode).toBe(0);
}, 120_000);

describe("in-repo test bench CLI smoke — fixtures/minimal", () => {
  it("show returns symbol matches", async () => {
    const r = await runCli(["show", "usePermissions", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.err).toBe("");
    const payload = JSON.parse(r.out) as { matches: unknown[] };
    expect(payload.matches.length).toBeGreaterThan(0);
  });

  it("snippet returns source for a symbol", async () => {
    const r = await runCli(["snippet", "usePermissions", "--json"]);
    expect(r.exitCode).toBe(0);
    const payload = JSON.parse(r.out) as {
      matches: Array<{ source?: string; missing: boolean }>;
    };
    expect(payload.matches[0]?.missing).toBe(false);
    expect(payload.matches[0]?.source).toContain("usePermissions");
  });

  it("impact returns neighborhood matches", async () => {
    const r = await runCli([
      "impact",
      "usePermissions",
      "--json",
      "--depth",
      "1",
    ]);
    expect(r.exitCode).toBe(0);
    const payload = JSON.parse(r.out) as { matches: unknown[] };
    expect(payload.matches.length).toBeGreaterThan(0);
  });

  it("validate reports no drift on a fresh index", async () => {
    const r = await runCli(["validate", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual([]);
  });

  it("query --recipe shop-symbols returns project-local recipe rows", async () => {
    const r = await runCli(["query", "--recipe", "shop-symbols", "--json"]);
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.out) as Array<{
      name: string;
      file_path: string;
      actions?: unknown[];
    }>;
    expect(rows.some((row) => row.name === "ProductCard")).toBe(true);
    expect(rows[0]?.actions?.length).toBeGreaterThan(0);
  });

  it("query --format sarif emits SARIF for boundary-violations", async () => {
    const r = await runCli([
      "query",
      "--recipe",
      "boundary-violations",
      "--format",
      "sarif",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.err).toBe("");
    const payload = JSON.parse(r.out) as { version: string; runs: unknown[] };
    expect(payload.version).toBe("2.1.0");
    expect(payload.runs.length).toBeGreaterThan(0);
  });
});
