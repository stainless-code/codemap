import { parseWorkerInput } from "./parse-worker-core";
import type { WorkerInput } from "./parse-worker-core";

export type {
  ParsedFile,
  WorkerInput,
  WorkerOutput,
} from "./parse-worker-core";

declare var self: Worker;

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  self.postMessage(parseWorkerInput(event.data));
};
