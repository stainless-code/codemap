import { statSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import {
  ParseTimeoutError,
  computeParseTimeoutMs,
  parseParseTimeoutMsOverride,
} from "./application/parse-timeout";
import { CODEMAP_BUILD_OUTPUT_DIR } from "./build-output";
import type { ParsedFile, WorkerInput, WorkerOutput } from "./parse-worker";
import { parseWorkerInput } from "./parse-worker-core";
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

const PARSE_WORKER_COUNT_RE = /^\d+$/;
const RECYCLE_EVERY_RE = /^\d+$/;

const DEFAULT_WORKER_RECYCLE_EVERY = 250;
/** Avoid worker spawn tax on tiny targeted/incremental batches. */
const INLINE_PARSE_MAX = 12;
/** Cap a single worker message budget so one hung file cannot block a huge chunk until sum(timeouts). */
const CHUNK_TIMEOUT_CAP_MS = 120_000;

/** Returns clamped override [1, 32], or `null` when unset/empty/invalid. */
export function parseParseWorkerCountOverride(
  env: string | undefined,
): number | null {
  if (env === undefined || env === "") return null;
  if (!PARSE_WORKER_COUNT_RE.test(env)) return null;
  const parsed = Number(env);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 32);
}

export function parseWorkerRecycleEvery(
  env: string | undefined = process.env.CODEMAP_WORKER_RECYCLE_EVERY,
): number {
  if (env === undefined || env === "") return DEFAULT_WORKER_RECYCLE_EVERY;
  if (!RECYCLE_EVERY_RE.test(env)) {
    console.error(
      `[worker-pool] ignoring invalid CODEMAP_WORKER_RECYCLE_EVERY=${JSON.stringify(env)} (expected positive integer)`,
    );
    return DEFAULT_WORKER_RECYCLE_EVERY;
  }
  const parsed = Number(env);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    console.error(
      `[worker-pool] ignoring invalid CODEMAP_WORKER_RECYCLE_EVERY=${JSON.stringify(env)} (expected positive integer)`,
    );
    return DEFAULT_WORKER_RECYCLE_EVERY;
  }
  return parsed;
}

function resolveWorkerCount(): number {
  const env = process.env.CODEMAP_PARSE_WORKERS;
  const override = parseParseWorkerCountOverride(env);
  if (override !== null) return override;
  if (env !== undefined && env !== "") {
    console.error(
      `[worker-pool] ignoring invalid CODEMAP_PARSE_WORKERS=${JSON.stringify(env)} (expected positive integer ≤32)`,
    );
  }
  return Math.max(2, Math.min(cpus().length || 4, 6));
}

const WORKER_COUNT = resolveWorkerCount();
const IS_BUN = typeof Bun !== "undefined";
const NODE_WORKER_PATH = IS_BUN ? "" : fileURLToPath(WORKER_URL_NODE);

interface ParseWorkerSession {
  parse(input: WorkerInput, timeoutMs: number): Promise<WorkerOutput>;
  dispose(): void;
}

interface PendingParse {
  gen: number;
  resolve: (value: WorkerOutput) => void;
  reject: (err: Error) => void;
  clearTimer: () => void;
}

function createParseWorkerSession(): ParseWorkerSession {
  let generation = 0;
  let pending: PendingParse | undefined;

  const clearPending = (): void => {
    if (pending === undefined) return;
    pending.clearTimer();
    pending = undefined;
  };

  const settleSuccess = (data: WorkerOutput): void => {
    if (!pending || pending.gen !== generation) return;
    const { resolve, clearTimer } = pending;
    clearTimer();
    pending = undefined;
    resolve(data);
  };

  const settleError = (err: Error): void => {
    if (!pending || pending.gen !== generation) return;
    const { reject, clearTimer } = pending;
    clearTimer();
    pending = undefined;
    reject(err);
  };

  const parseWithTimeout = (
    timeoutMs: number,
    postMessage: () => void,
    recycleWorker: () => void,
  ): Promise<WorkerOutput> => {
    const gen = generation;
    return new Promise<WorkerOutput>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        timer = undefined;
        if (!pending || pending.gen !== gen) return;
        pending = undefined;
        generation++;
        recycleWorker();
        reject(new ParseTimeoutError(timeoutMs));
      }, timeoutMs);

      pending = {
        gen,
        resolve,
        reject,
        clearTimer: () => {
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
        },
      };
      postMessage();
    });
  };

  const disposeSession = (terminateWorker: () => void): void => {
    clearPending();
    generation++;
    terminateWorker();
  };

  if (IS_BUN) {
    let worker = new Worker(WORKER_URL_BUN);
    const attach = (): void => {
      worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
        settleSuccess(event.data);
      };
      worker.onerror = (event: ErrorEvent) => {
        settleError(event.error ?? new Error(event.message));
      };
    };
    attach();

    return {
      parse(input, timeoutMs) {
        return parseWithTimeout(
          timeoutMs,
          () => {
            worker.postMessage(input);
          },
          () => {
            worker.terminate();
            worker = new Worker(WORKER_URL_BUN);
            attach();
          },
        );
      },
      dispose() {
        disposeSession(() => {
          worker.terminate();
        });
      },
    };
  }

  let worker = new NodeWorker(NODE_WORKER_PATH, {
    type: "module",
  } as import("node:worker_threads").WorkerOptions);

  const attachNode = (): void => {
    worker.on("message", (data: WorkerOutput) => {
      settleSuccess(data);
    });
    worker.on("error", (err: Error) => {
      settleError(err);
    });
  };
  attachNode();

  return {
    parse(input, timeoutMs) {
      return parseWithTimeout(
        timeoutMs,
        () => {
          worker.postMessage(input);
        },
        () => {
          void worker.terminate();
          worker = new NodeWorker(NODE_WORKER_PATH, {
            type: "module",
          } as import("node:worker_threads").WorkerOptions);
          attachNode();
        },
      );
    },
    dispose() {
      disposeSession(() => {
        void worker.terminate();
      });
    },
  };
}

function fileSizeBytes(projectRoot: string, relPath: string): number {
  try {
    return statSync(join(projectRoot, relPath)).size;
  } catch {
    return 0;
  }
}

function chunkBudgetMs(
  files: readonly string[],
  projectRoot: string,
  timeoutEnv: string | undefined,
): number {
  let sum = 0;
  for (const relPath of files) {
    sum += computeParseTimeoutMs(
      fileSizeBytes(projectRoot, relPath),
      timeoutEnv,
    );
  }
  return Math.min(sum, CHUNK_TIMEOUT_CAP_MS);
}

function timeoutParsedFile(
  relPath: string,
  projectRoot: string,
  timeoutMs: number,
): ParsedFile {
  const reason = `parse timed out after ${timeoutMs}ms`;
  try {
    const stat = statSync(join(projectRoot, relPath));
    return {
      relPath,
      parseError: reason,
      fileRow: {
        path: relPath,
        content_hash: "",
        size: stat.size,
        line_count: 0,
        language: "text",
        last_modified: Math.floor(stat.mtimeMs),
        indexed_at: Date.now(),
      },
      category: "text",
    };
  } catch {
    return {
      relPath,
      error: true,
      fileRow: {} as ParsedFile["fileRow"],
      category: "text",
    };
  }
}

async function parseOneFile(
  session: ParseWorkerSession,
  relPath: string,
  projectRoot: string,
  fts5Enabled: boolean,
  timeoutEnv: string | undefined,
): Promise<ParsedFile> {
  const timeoutMs = computeParseTimeoutMs(
    fileSizeBytes(projectRoot, relPath),
    timeoutEnv,
  );
  const input: WorkerInput = {
    files: [relPath],
    projectRoot,
    fts5Enabled,
  };
  try {
    const output = await session.parse(input, timeoutMs);
    return (
      output.results[0] ?? timeoutParsedFile(relPath, projectRoot, timeoutMs)
    );
  } catch (err) {
    if (err instanceof ParseTimeoutError) {
      return timeoutParsedFile(relPath, projectRoot, err.timeoutMs);
    }
    throw err;
  }
}

async function parseChunkFiles(
  session: ParseWorkerSession,
  files: readonly string[],
  projectRoot: string,
  fts5Enabled: boolean,
  timeoutEnv: string | undefined,
): Promise<ParsedFile[]> {
  if (files.length === 0) return [];
  if (files.length === 1) {
    return [
      await parseOneFile(
        session,
        files[0]!,
        projectRoot,
        fts5Enabled,
        timeoutEnv,
      ),
    ];
  }

  const timeoutMs = chunkBudgetMs(files, projectRoot, timeoutEnv);
  const input: WorkerInput = { files: [...files], projectRoot, fts5Enabled };
  try {
    const output = await session.parse(input, timeoutMs);
    return output.results;
  } catch (err) {
    if (!(err instanceof ParseTimeoutError)) throw err;
    const mid = Math.ceil(files.length / 2);
    const left = await parseChunkFiles(
      session,
      files.slice(0, mid),
      projectRoot,
      fts5Enabled,
      timeoutEnv,
    );
    const right = await parseChunkFiles(
      session,
      files.slice(mid),
      projectRoot,
      fts5Enabled,
      timeoutEnv,
    );
    return [...left, ...right];
  }
}

function splitWorkerChunks(filePaths: readonly string[]): string[][] {
  const chunkSize = Math.ceil(filePaths.length / WORKER_COUNT);
  const chunks: string[][] = [];
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize));
  }
  return chunks;
}

export function parseFilesParallel(filePaths: string[]): Promise<ParsedFile[]> {
  if (filePaths.length === 0) return Promise.resolve([]);

  const projectRoot = getProjectRoot();
  const fts5Enabled = getFts5Enabled();
  const timeoutEnv = process.env.CODEMAP_PARSE_TIMEOUT_MS;
  if (
    timeoutEnv !== undefined &&
    timeoutEnv !== "" &&
    parseParseTimeoutMsOverride(timeoutEnv) === null
  ) {
    console.error(
      `[worker-pool] ignoring invalid CODEMAP_PARSE_TIMEOUT_MS=${JSON.stringify(timeoutEnv)} (expected positive integer)`,
    );
  }

  if (filePaths.length <= INLINE_PARSE_MAX) {
    return Promise.resolve(
      parseWorkerInput({ files: [...filePaths], projectRoot, fts5Enabled })
        .results,
    );
  }

  const recycleEvery = parseWorkerRecycleEvery();
  const chunks = splitWorkerChunks(filePaths);

  return Promise.all(
    chunks.map(async (chunk) => {
      let session = createParseWorkerSession();
      let processed = 0;
      try {
        const results: ParsedFile[] = [];
        for (let i = 0; i < chunk.length; ) {
          const sliceEnd = Math.min(i + recycleEvery, chunk.length);
          const slice = chunk.slice(i, sliceEnd);
          results.push(
            ...(await parseChunkFiles(
              session,
              slice,
              projectRoot,
              fts5Enabled,
              timeoutEnv,
            )),
          );
          processed += slice.length;
          i = sliceEnd;
          if (processed >= recycleEvery && i < chunk.length) {
            session.dispose();
            session = createParseWorkerSession();
            processed = 0;
          }
        }
        return results;
      } finally {
        session.dispose();
      }
    }),
  ).then((parts) => parts.flat());
}
