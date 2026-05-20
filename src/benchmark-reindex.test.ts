import { describe, expect, it } from "bun:test";

import { runBenchmarkReindex } from "./benchmark-reindex";

describe("runBenchmarkReindex", () => {
  it("throws when the indexer exits non-zero instead of recording a timing", async () => {
    let spawnCalls = 0;
    await expect(
      runBenchmarkReindex("fail case", ["--full"], {
        runs: 1,
        spawnIndexer: async () => {
          spawnCalls++;
          return {
            exitCode: 1,
            stderr: "indexer exploded",
            stdout: "",
          };
        },
      }),
    ).rejects.toThrow(/benchmark reindex "fail case" failed \(exit 1\)/);
    expect(spawnCalls).toBe(1);
  });

  it("rejects invalid runs values", async () => {
    const spawnIndexer = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    await expect(
      runBenchmarkReindex("bad-runs", [], { runs: 0, spawnIndexer }),
    ).rejects.toThrow(/requires runs >= 1/);
    await expect(
      runBenchmarkReindex("bad-runs", [], { runs: -1, spawnIndexer }),
    ).rejects.toThrow(/requires runs >= 1/);
    await expect(
      runBenchmarkReindex("bad-runs", [], { runs: 1.5, spawnIndexer }),
    ).rejects.toThrow(/requires runs >= 1/);
  });

  it("records timings when every run exits zero", async () => {
    const result = await runBenchmarkReindex("ok", [], {
      runs: 2,
      spawnIndexer: async () => ({
        exitCode: 0,
        stderr: "",
        stdout: "",
      }),
    });
    expect(result.label).toBe("ok");
    expect(result.runs).toBe(2);
    expect(result.avg).toBeGreaterThanOrEqual(0);
  });
});
