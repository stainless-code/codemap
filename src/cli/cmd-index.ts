import { extname } from "node:path";

import { VALID_EXTENSIONS } from "../application/index-engine";
import { runCodemapIndex } from "../application/run-index";
import { closeDb, openDb } from "../db";
import { bootstrapCodemap } from "./bootstrap-codemap";
import { parseIndexFilesArgs } from "./bootstrap.js";

/** Incremental/full index, or targeted `--files` via `parseIndexFilesArgs`. */
export async function runIndexCmd(opts: {
  root: string;
  configFile: string | undefined;
  stateDir?: string | undefined;
  fts5Cli?: boolean | undefined;
  rest: string[];
}): Promise<void> {
  await bootstrapCodemap(opts);

  const args = opts.rest;
  const targetFiles = parseIndexFilesArgs(args);
  const db = openDb();
  try {
    if (targetFiles !== null) {
      for (const f of targetFiles) {
        if (!VALID_EXTENSIONS.has(extname(f))) {
          console.warn(`  ${f}: non-standard extension, indexing as text`);
        }
      }
      await runCodemapIndex(db, {
        mode: "files",
        files: targetFiles,
      });
    } else {
      const fullRebuild = args.includes("--full");
      const reportPerformance = args.includes("--performance");
      await runCodemapIndex(db, {
        mode: fullRebuild ? "full" : "incremental",
        performance: reportPerformance,
      });
    }
  } finally {
    closeDb(db);
  }
}
