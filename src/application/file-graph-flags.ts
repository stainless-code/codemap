import type { CodemapDatabase } from "../db";

const TS_LANGUAGES = "('ts','tsx','mts','cts','js','jsx','mjs','cjs')";

const VALUE_SYMBOL_KINDS =
  "('function','const','let','var','class','enum','method','getter','setter','property')";

/** Recompute `files.is_barrel` from exports + value-symbol rows (Tier 6 post-pass). */
export function persistFileBarrelFlags(db: CodemapDatabase): void {
  db.run(`
    UPDATE files
    SET is_barrel = 0
    WHERE language IN ${TS_LANGUAGES}
  `);
  db.run(`
    UPDATE files
    SET is_barrel = 1
    WHERE language IN ${TS_LANGUAGES}
      AND EXISTS (
        SELECT 1 FROM exports e WHERE e.file_path = files.path
      )
      AND NOT EXISTS (
        SELECT 1 FROM exports e
        WHERE e.file_path = files.path AND e.is_re_export = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM symbols s
        WHERE s.file_path = files.path
          AND s.kind IN ${VALUE_SYMBOL_KINDS}
      )
  `);
}
