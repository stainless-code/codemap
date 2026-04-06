import { parentPort } from "node:worker_threads";

import { parseWorkerInput } from "./parse-worker-core";
import type { WorkerInput } from "./parse-worker-core";

if (!parentPort) {
  throw new Error("parse-worker-node must run in a worker thread");
}

parentPort.on("message", (data: WorkerInput) => {
  parentPort!.postMessage(parseWorkerInput(data));
});
