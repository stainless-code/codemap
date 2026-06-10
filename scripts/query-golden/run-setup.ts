import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  ingestIstanbul,
  ingestLcov,
} from "../../src/application/coverage-engine";
import { closeDb, openDb, replaceFileChurn } from "../../src/db";
import type { FileChurnRow } from "../../src/db";
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
  const fixtureAbs = resolve(fixtureRoot);
  const db = openDb();
  try {
    for (const step of steps) {
      if (step.kind === "clear-coverage") {
        db.run("DELETE FROM coverage");
        continue;
      }
      if (step.kind === "seed-file-churn") {
        const absPath = resolve(fixtureRoot, step.path);
        if (
          absPath !== fixtureAbs &&
          !absPath.startsWith(`${fixtureAbs}${sep}`)
        ) {
          throw new Error(
            `query-golden setup: path must stay under fixture root (${step.path})`,
          );
        }
        if (!existsSync(absPath)) {
          throw new Error(
            `query-golden setup: missing file-churn seed ${absPath}`,
          );
        }
        const rows = JSON.parse(
          readFileSync(absPath, "utf-8"),
        ) as FileChurnRow[];
        replaceFileChurn(db, rows);
        continue;
      }
      if (step.kind !== "ingest-coverage") continue;
      const absPath = resolve(fixtureRoot, step.path);
      if (
        absPath !== fixtureAbs &&
        !absPath.startsWith(`${fixtureAbs}${sep}`)
      ) {
        throw new Error(
          `query-golden setup: path must stay under fixture root (${step.path})`,
        );
      }
      if (!existsSync(absPath)) {
        console.warn(
          `  query-golden setup: skipping missing coverage file ${absPath}`,
        );
        continue;
      }
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
