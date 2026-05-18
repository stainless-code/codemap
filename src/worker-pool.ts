import { cpus } from "node:os";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import { CODEMAP_BUILD_OUTPUT_DIR } from "./build-output";
import type { ParsedFile, WorkerInput, WorkerOutput } from "./parse-worker";
import { getFts5Enabled, getProjectRoot } from "./runtime";

const fromDist =
  basename(dirname(fileURLToPath(import.meta.url))) ===
  CODEMAP_BUILD_OUTPUT_DIR;

const WORKER_URL_BUN = new URL(
  fromDist ? "./parse-worker.mjs" : "./parse-worker.ts",
  import.meta.url,
);
const WORKER_URL_NODE = new URL(
  fromDist ? "./parse-worker-node.mjs" : "./parse-worker-node.ts",
  import.meta.url,
);

// Override via `CODEMAP_PARSE_WORKERS` (clamped [1, 32]); default formula unchanged when unset.
function resolveWorkerCount(): number {
  const env = process.env.CODEMAP_PARSE_WORKERS;
  if (env !== undefined && env !== "") {
    const parsed = Number.parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(parsed, 32);
    }
    console.error(
      `[worker-pool] ignoring invalid CODEMAP_PARSE_WORKERS=${JSON.stringify(env)} (expected positive integer ≤32)`,
    );
  }
  return Math.max(2, Math.min(cpus().length || 4, 6));
}

const WORKER_COUNT = resolveWorkerCount();
const IS_BUN = typeof Bun !== "undefined";
const NODE_WORKER_PATH = IS_BUN ? "" : fileURLToPath(WORKER_URL_NODE);

export function parseFilesParallel(filePaths: string[]): Promise<ParsedFile[]> {
  const chunkSize = Math.ceil(filePaths.length / WORKER_COUNT);
  const chunks: string[][] = [];
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize));
  }

  const projectRoot = getProjectRoot();
  const fts5Enabled = getFts5Enabled();

  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<ParsedFile[]>((resolve, reject) => {
          const input: WorkerInput = {
            files: chunk,
            projectRoot,
            fts5Enabled,
          };

          if (IS_BUN) {
            const worker = new Worker(WORKER_URL_BUN);
            worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
              resolve(event.data.results);
              worker.terminate();
            };
            worker.onerror = (event: ErrorEvent) => {
              reject(new Error(event.message));
              worker.terminate();
            };
            worker.postMessage(input);
            return;
          }

          const worker = new NodeWorker(NODE_WORKER_PATH, {
            type: "module",
          } as import("node:worker_threads").WorkerOptions);
          worker.on("message", (data: WorkerOutput) => {
            resolve(data.results);
            void worker.terminate();
          });
          worker.on("error", reject);
          worker.postMessage(input);
        }),
    ),
  ).then((parts) => parts.flat());
}
