import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ingestIstanbul,
  ingestLcov,
} from "../../src/application/coverage-engine";
import { closeDb, openDb } from "../../src/db";
import type { GoldenSetupStep } from "./schema";

/**
 * Run one-time setup steps after the corpus is indexed and before the first
 * scenario. Today: `ingest-coverage` (Istanbul / LCOV — auto-detected by
 * extension, mirrors the CLI verb). Extend the dispatch as more one-shot
 * ingest verbs land.
 */
export function runGoldenSetup(
  steps: GoldenSetupStep[],
  fixtureRoot: string,
): void {
  const db = openDb();
  try {
    for (const step of steps) {
      if (step.kind !== "ingest-coverage") continue;
      const absPath = resolve(fixtureRoot, step.path);
      if (absPath.endsWith(".json")) {
        const payload = JSON.parse(
          readFileSync(absPath, "utf-8"),
        ) as Parameters<typeof ingestIstanbul>[0]["payload"];
        ingestIstanbul({
          db,
          projectRoot: fixtureRoot,
          payload,
          sourcePath: absPath,
        });
      } else if (absPath.endsWith(".info")) {
        ingestLcov({
          db,
          projectRoot: fixtureRoot,
          payload: readFileSync(absPath, "utf-8"),
          sourcePath: absPath,
        });
      } else {
        throw new Error(
          `query-golden setup: cannot auto-detect coverage format from ${absPath}`,
        );
      }
    }
  } finally {
    closeDb(db);
  }
}
