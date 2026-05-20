async function timeMsAsync(fn: () => Promise<void>): Promise<{ ms: number }> {
  const start = performance.now();
  await fn();
  return { ms: performance.now() - start };
}

export interface IndexerSpawnResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

export type IndexerSpawn = (args: string[]) => Promise<IndexerSpawnResult>;

export async function runBenchmarkReindex(
  label: string,
  args: string[],
  opts: { spawnIndexer: IndexerSpawn; runs?: number },
): Promise<{
  label: string;
  avg: number;
  min: number;
  max: number;
  runs: number;
}> {
  const runs = opts.runs ?? 3;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = await timeMsAsync(async () => {
      const { exitCode, stderr, stdout } = await opts.spawnIndexer(args);
      if (exitCode !== 0) {
        const detail = [stderr, stdout].filter(Boolean).join("\n").trim();
        throw new Error(
          `benchmark reindex "${label}" failed (exit ${exitCode ?? "?"}): ${detail || "(no output)"}`,
        );
      }
    });
    times.push(t.ms);
  }
  const avg = times.reduce((a, b) => a + b, 0) / runs;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { label, avg, min, max, runs };
}
