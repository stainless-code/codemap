import { cpus } from "node:os";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import { CODEMAP_BUILD_OUTPUT_DIR } from "./build-output";
import type { ParsedFile, WorkerInput, WorkerOutput } from "./parse-worker";
import { getProjectRoot } from "./runtime";

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

const WORKER_COUNT = Math.max(2, Math.min(cpus().length || 4, 6));

export function parseFilesParallel(filePaths: string[]): Promise<ParsedFile[]> {
  const chunkSize = Math.ceil(filePaths.length / WORKER_COUNT);
  const chunks: string[][] = [];
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize));
  }

  return Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<ParsedFile[]>((resolve, reject) => {
          const input: WorkerInput = {
            files: chunk,
            projectRoot: getProjectRoot(),
          };

          if (typeof Bun !== "undefined") {
            const worker = new Worker(WORKER_URL_BUN);
            worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
              resolve(event.data.results);
              worker.terminate();
            };
            worker.postMessage(input);
            return;
          }

          const workerPath = fileURLToPath(WORKER_URL_NODE);
          const worker = new NodeWorker(workerPath, {
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
