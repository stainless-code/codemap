import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function runCli(
  args: string[],
): Promise<{ exitCode: number; out: string; err: string }> {
  const indexTs = join(import.meta.dir, "..", "index.ts");
  const proc = Bun.spawn([Bun.which("bun")!, indexTs, ...args], {
    cwd: join(import.meta.dir, "..", ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

const root = join(import.meta.dir, "..", "..");
const hasDb = existsSync(join(root, ".codemap", "index.db"));
const describeIntegration = hasDb ? describe : describe.skip;

describeIntegration("query default vs --json (integration)", () => {
  test("--json parses to a JSON array with expected row count", async () => {
    const sql =
      "SELECT name FROM symbols ORDER BY file_path, line_start LIMIT 7";
    const { exitCode, out, err } = await runCli(["query", "--json", sql]);
    expect(exitCode).toBe(0);
    expect(err).toBe("");
    const rows = JSON.parse(out) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(7);
  });

  test("--json stdout is smaller than console.table for multi-row results", async () => {
    const sql =
      "SELECT name, kind FROM symbols ORDER BY file_path, line_start LIMIT 50";
    const table = await runCli(["query", sql]);
    const json = await runCli(["query", "--json", sql]);
    expect(table.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    expect(json.out.length).toBeLessThan(table.out.length);
  });
});
